/**
 * Chat Orchestration v2 — Model-Agnostic via Vercel AI SDK
 *
 * Owns the model loop, the SSE event stream and DB persistence. Each LLM call
 * (model-call.ts), tool dispatch, large-output handling and the system prompt
 * live in their own modules.
 */

import type { ModelMessage, ToolResultPart } from "ai";
import { v4 as uuidv4 } from "uuid";
import { chatProviderOptions, loadLLMConfig, sanitizeToolName } from "../llm";
import {
  db,
  messageQueries,
  chatSessionQueries,
  chatTurnQueries,
  userQueries,
  dailyUsageQueries,
  usageEventQueries,
} from "../db";
import { logger, startTimer, type LogContext } from "../logger";
import { getUtcDate, getUtcMonth } from "../usage";
import { SYSTEM_PROMPT } from "./context/system-prompt";
import { applyCacheMarkers, cachedInstructions } from "./context/cache-markers";
import { appendTranscript, contextVersion, loadTranscript, type TranscriptTag } from "./context/transcript";
import { toolRegistry } from "../mcp/registry";
import { buildToolCatalog, countDeferred, registeredToolNames } from "./context/tool-catalog";
import { dispatchToolCall, toDeclarations, type DispatchContext } from "./tool-dispatch";
import type { StreamEvent, ToolCallRecord } from "./types";
import { UsageMeter } from "./usage-meter";
import { CallTracker, recordFailedTurn } from "./turn-usage";
import {
  TURN_IN_PROGRESS_MESSAGE,
  TurnError,
  acquireSessionLock,
  classifyTurnError,
  finishFailedTurn,
  refusalError,
  startTurn,
  type TurnFailure,
} from "./chat-turn";
import { joinReasoning } from "./reasoning";
import { streamModelCall } from "./model-call";

export type { StreamEvent, ToolCallRecord } from "./types";
export { generateSessionTitle } from "./session-title";

const llmConfig = loadLLMConfig();
// Thinking + effort (Anthropic); undefined on Google.
const providerOptions = chatProviderOptions(llmConfig);
// Stored on every model_transcript row (compatibility check for replay).
const transcriptTag: TranscriptTag = {
  provider: llmConfig.provider,
  model: llmConfig.chatModel,
  contextVersion: contextVersion(SYSTEM_PROMPT, providerOptions),
};

// ── Main Chat Loop ─────────────────────────────────────────────────────────

/**
 * `signal` is aborted when the client disconnects: the in-flight LLM call and
 * tool calls are cancelled, no further iterations run, and no assistant message
 * is persisted. The same happens when the consumer stops iterating before the
 * turn completed (e.g. an SSE write threw). A failed or aborted turn still
 * records the cost of its LLM calls (status "error", see turn-usage.ts).
 *
 * Every turn has a chat_turns row (`turnId`), created `running` with the user
 * message and finalized as ok / error / aborted; its usage_events row links to
 * it. Only one turn per session runs at a time (chat-turn.ts).
 *
 * Every message the model is sent from this turn on (the user message, each
 * assistant response including the final one, each tool-result message) is
 * appended to model_transcript as the iteration finishes (context/transcript.ts).
 * Failed turns keep the messages they got to, refused responses included;
 * replay will read `ok` turns only.
 */
export async function* processChat(
  sessionId: string,
  userId: string,
  userMessage: string,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const chatElapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId, user_id: userId };
  const sanitize = (name: string) => sanitizeToolName(name, llmConfig.provider);

  logger.info("CHAT", "process_start", {
    ctx,
    data: {
      provider: llmConfig.provider,
      model: llmConfig.chatModel,
      message_length: userMessage.length,
      message_preview: userMessage.slice(0, 150),
    },
  });

  // Every finished LLM call, priced on its own. Outside the try so a failed or
  // aborted turn can still see the calls that finished.
  const meter = new UsageMeter(llmConfig.provider, llmConfig.chatModel, ctx);
  const tracker = new CallTracker(llmConfig.maxContextTokens);
  // Set once the success path wrote its usage_events row.
  let ledgerWritten = false;
  // The turn's own signal: follows the caller's, and is aborted in `finally` so
  // an early return() by the consumer also cancels the in-flight LLM/tool call.
  const turnAbort = new AbortController();
  const turnSignal = signal ? AbortSignal.any([signal, turnAbort.signal]) : turnAbort.signal;
  // How the turn failed; unset if the consumer stopped iterating early ("closed").
  let failure: TurnFailure | undefined;
  // Set once the turn's chat_turns row exists.
  let turnId: string | null = null;
  let loopIteration = 0;
  let releaseLock: (() => void) | null = null;

  try {
    // Session check
    const session = chatSessionQueries.findById(sessionId);
    if (session && session.user_id !== userId) {
      logger.warn("CHAT", "session_unauthorized", { ctx, data: { session_owner: session.user_id } });
      yield { type: "error", data: { error: "Unauthorized: session belongs to another user" } };
      return;
    }

    // One turn per session at a time. Taken synchronously with the session
    // insert below, so two first requests to a new session can't both pass.
    releaseLock = acquireSessionLock(sessionId);
    if (!releaseLock) {
      logger.warn("CHAT", "turn_in_progress", { ctx });
      yield { type: "error", data: { error: TURN_IN_PROGRESS_MESSAGE, code: "turn_in_progress" } };
      return;
    }

    if (!session) {
      chatSessionQueries.create(sessionId, userId, null);
      logger.info("CHAT", "session_created", { ctx });
    }

    // History (read before this turn's user message is stored)
    const history = loadTranscript(sessionId, {
      ...transcriptTag,
      toolNames: registeredToolNames(sanitize),
      onDegraded: (previousTurnId, reason) => logger.info("CHAT", "transcript_degraded", {
        ctx,
        data: { turn_id: previousTurnId, ...reason },
      }),
    });
    const messages = history.messages;
    const turnGapSeconds = history.previousFinishedAt === undefined ? null : Math.max(0, Date.now() / 1000 - history.previousFinishedAt);

    // Store the user message with its turn (status running).
    const turn = startTurn(sessionId, userMessage);
    turnId = turn.turnId;
    ctx.turn_id = turnId;
    logger.info("CHAT", "turn_started", { ctx, data: { turn_id: turnId, turn_gap_seconds: turnGapSeconds } });

    // Adds messages to what the next call sends and to the transcript, so
    // what is stored is exactly what was sent.
    const send = (...added: ModelMessage[]) => {
      messages.push(...added);
      appendTranscript(sessionId, turn.turnId, added, transcriptTag);
    };
    send({ role: "user", content: userMessage });

    yield { type: "start", data: { sessionId } };

    // All servers down: checked on availability, not on the tool list, which
    // (on Anthropic) declares every registered tool whether available or not.
    if (toolRegistry.availableCount === 0) {
      logger.error("CHAT", "no_tools_available", { ctx });
      throw new TurnError("no_tools_available", "No MCP tools available. All database servers may be down.");
    }

    // Anthropic: fixed for the whole turn. Gemini: search grows it (tool-dispatch).
    const activeTools = buildToolCatalog(llmConfig.provider, sanitize, sessionId);
    const deferredCount = countDeferred(activeTools);

    logger.info("CHAT", "tools_loaded", {
      ctx,
      data: {
        loaded_tools: Object.keys(activeTools).length - deferredCount,
        deferred_tools: deferredCount,
        total_tools: Object.keys(activeTools).length,
        provider: llmConfig.provider,
      },
    });

    let continueLoop = true;
    let persistedAssistantText = ""; // final response text only (last iteration)
    const reasoningBlocks: string[] = []; // thinking (all iterations) + pre-tool-call text (non-final iterations)
    const allToolCalls: ToolCallRecord[] = [];
    // Prompt caching (Anthropic only): instructions carry the tools + system
    // breakpoint; message breakpoints go on a per-call copy (cache-markers.ts).
    const caching = llmConfig.provider === "anthropic";
    const instructions = caching ? cachedInstructions(SYSTEM_PROMPT) : SYSTEM_PROMPT;
    // The previous successful turn's final input endpoint carries across turns.
    let previousLastIndex = history.previousLastIndex;
    if (previousLastIndex !== undefined && history.previousPromptTokens !== undefined) {
      tracker.carryOver(history.previousPromptTokens, previousLastIndex + 1);
    }

    while (continueLoop) {
      turnSignal.throwIfAborted();
      if (loopIteration >= llmConfig.maxToolIterations) {
        throw new TurnError("max_tool_iterations", `Maximum tool iterations exceeded (${llmConfig.maxToolIterations})`);
      }
      loopIteration++;
      const iterElapsed = startTimer();

      logger.info("CHAT", "llm_request_start", {
        ctx,
        data: {
          iteration: loopIteration,
          model: llmConfig.chatModel,
          message_count: messages.length,
          active_tools: Object.keys(activeTools).length,
        },
      });

      // Strip execute functions — we handle execution manually for
      // SSE events, search activation, and output compression.
      const declarationTools = toDeclarations(activeTools);
      const callLastIndex = messages.length - 1;
      const { text: callText, segments: callSegments, finishReason, rawFinishReason, toolCalls, finalStep } =
        yield* streamModelCall({
          iteration: loopIteration,
          llmConfig,
          providerOptions,
          instructions,
          messages: caching ? applyCacheMarkers(messages, previousLastIndex) : messages,
          tools: declarationTools,
          tracker,
          signal: turnSignal,
        });

      const call = meter.record(finalStep.usage, finalStep.providerMetadata, {
        iteration: loopIteration,
        durationMs: iterElapsed(),
        finishReason,
        toolCalls: toolCalls?.length ?? 0,
        toolNames: Object.keys(declarationTools),
        systemPrompt: SYSTEM_PROMPT,
      });
      tracker.finish(call);
      if (loopIteration === 1) {
        logger.info("CHAT", "first_call_cache_read", {
          ctx,
          data: { first_call_cache_read: call.cacheReadTokens, turn_gap_seconds: turnGapSeconds },
        });
      }
      // The SDK's response messages as returned: they keep provider metadata
      // (thinking signatures, redacted thinking, Gemini thought signatures)
      // the model requires on later calls. Tool results come from our own
      // dispatch below, so the SDK's tool messages are skipped. The final
      // call's message is kept too: the next turn's cache prefix ends with it.
      send(...finalStep.response.messages.filter((msg) => msg.role !== "tool"));
      // A safety refusal: billed (metered above), never saved as an answer.
      // Its response message stays in the transcript (failed turns aren't replayed).
      if (finishReason === "content-filter") {
        throw refusalError(rawFinishReason, finalStep.providerMetadata);
      }
      previousLastIndex = callLastIndex;
      const isToolCall = finishReason === "tool-calls" && toolCalls && toolCalls.length > 0;
      // Stored reasoning: this call's thinking, plus its text when the text is
      // pre-tool-call, in stream order (matches the client's segments).
      for (const seg of callSegments) {
        if (seg.thinking || isToolCall) reasoningBlocks.push(seg.text);
      }

      if (isToolCall) {
        // This iteration's text is reasoning (pre-tool-call); signal the client to reclassify it.
        if (callText) {
          yield { type: "text_block_end", data: { isReasoning: true } };
        }

        const toolResultParts: ToolResultPart[] = [];
        const dispatch: DispatchContext = {
          sessionId,
          provider: llmConfig.provider,
          sanitize,
          activeTools,
          ctx,
          signal: turnSignal,
        };

        for (const tc of toolCalls) {
          turnSignal.throwIfAborted();
          const { record, part } = yield* dispatchToolCall(tc, dispatch);
          if (record) allToolCalls.push(record);
          toolResultParts.push(part);
        }

        // Our manually dispatched tool results (after handleLargeOutput, with fetched_at)
        send({ role: "tool", content: toolResultParts });
      } else {
        // Final iteration — this text is the actual response.
        if (callText) {
          persistedAssistantText = callText;
        }
        continueLoop = false;
      }
    }

    const chatCost = meter.summary();

    const assistantMsgId = uuidv4();
    const usageEventId = uuidv4();
    const usageDate = getUtcDate();
    const usageMonth = getUtcMonth();

    // Sync transaction on the shared connection: the *Queries calls below use the
    // global `db`, so they run inside it without needing the `tx` handle.
    db.transaction(() => {
      // Store assistant message with accumulated token counts, cost, and reasoning.
      messageQueries.create(
        assistantMsgId,
        sessionId,
        "assistant",
        persistedAssistantText,
        allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null,
        chatCost.inputTokens,
        chatCost.outputTokens,
        joinReasoning(reasoningBlocks) || null,
        chatCost.costMicrousd
      );

      usageEventQueries.create({
        id: usageEventId,
        user_id: userId,
        date: usageDate,
        month: usageMonth,
        operation: "chat",
        provider: llmConfig.provider,
        model: llmConfig.chatModel,
        ...meter.ledgerFields(chatCost),
        status: "ok",
        session_id: sessionId,
        message_id: assistantMsgId,
        turn_id: turn.turnId,
      });

      chatTurnQueries.finish(turn.turnId, {
        status: "ok",
        iterations: loopIteration,
        assistantMessageId: assistantMsgId,
        lastPromptTokens: tracker.lastPromptTokens,
      });

      chatSessionQueries.touch(sessionId);
      userQueries.incrementQueries(userId);
      // Increment daily token totals (best-effort: done post-response; next request checks these)
      dailyUsageQueries.incrementTokens(userId, chatCost.inputTokens, chatCost.outputTokens);
    });
    ledgerWritten = true;

    logger.info("CHAT", "process_complete", {
      ctx,
      duration_ms: chatElapsed(),
      data: {
        provider: llmConfig.provider,
        model: llmConfig.chatModel,
        iterations: loopIteration,
        tool_calls_total: allToolCalls.length,
        tool_calls_failed: allToolCalls.filter((t) => t.error).length,
        response_length: persistedAssistantText.length,
        message_id: assistantMsgId,
        ...meter.logFields(chatCost),
      },
    });

    // done arrives first so finalizeAssistantMessage() commits the message to
    // state.messages before the frontend's setLastMessageTokens runs.
    yield { type: "done", data: { messageId: assistantMsgId } };
    // usage arrives after done — safe to patch tokenUsage onto the last message
    yield { type: "usage", data: { inputTokens: chatCost.inputTokens, outputTokens: chatCost.outputTokens } };
  } catch (error) {
    if (turnSignal.aborted) {
      // Client is gone: nothing to stream an error to.
      failure = { code: "aborted", message: "Client disconnected", userMessage: "" };
      logger.info("CHAT", "process_aborted", { ctx, duration_ms: chatElapsed(), data: { error_code: failure.code } });
      return;
    }
    failure = classifyTurnError(error);
    logger.error("CHAT", "process_failed", {
      ctx,
      duration_ms: chatElapsed(),
      error: error instanceof Error ? error : failure.message,
      data: { error_code: failure.code },
    });
    yield { type: "error", data: { error: failure.userMessage, code: failure.code } };
  } finally {
    // Errors, aborts and an early return() by the consumer all end here; the
    // calls that already ran are billed either way. Cancel whatever is still in
    // flight first, so the cut-off estimate covers exactly what was streamed.
    // Never throws.
    if (!ledgerWritten) {
      turnAbort.abort();
      const errorCode = failure?.code ?? "closed";
      recordFailedTurn({
        meter,
        tracker,
        userId,
        sessionId,
        turnId,
        provider: llmConfig.provider,
        model: llmConfig.chatModel,
        ctx,
        errorCode,
      });
      if (turnId) {
        finishFailedTurn(
          turnId,
          {
            status: errorCode === "aborted" || errorCode === "closed" ? "aborted" : "error",
            errorCode,
            errorMessage: failure?.message ?? "Consumer stopped reading before the turn finished",
            iterations: loopIteration,
          },
          ctx
        );
      }
    }
    releaseLock?.();
  }
}
