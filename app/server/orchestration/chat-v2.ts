import type { ModelMessage, ToolResultPart } from "ai";
import { sanitizeToolName, type TurnLLMOverride } from "../llm";
import { chatSessionQueries } from "../db";
import { logger, startTimer, type LogContext } from "../logger";
import { SYSTEM_PROMPT } from "./context/system-prompt";
import { applyCacheMarkers, cachedInstructions } from "./context/cache-markers";
import { appendTranscript, loadTranscript } from "./context/transcript";
import { toolRegistry } from "../mcp/registry";
import { buildToolCatalog, countDeferred, registeredToolNames } from "./context/tool-catalog";
import { dispatchToolCall, toDeclarations, type DispatchContext } from "./tool-dispatch";
import type { StreamEvent, ToolCallRecord } from "./types";
import { UsageMeter } from "./usage-meter";
import { CallTracker, recordFailedTurn, recordOkTurn } from "./turn-usage";
import { TurnBudget, type CostBudget } from "./cost-budget";
import {
  TURN_IN_PROGRESS_MESSAGE,
  TurnError,
  acquireSessionLock,
  classifyTurnError,
  finishFailedTurn,
  recordTraceId,
  registerActiveTurn,
  refusalError,
  scoreTurn,
  startTurn,
  type TurnFailure,
} from "./chat-turn";
import { joinReasoning } from "./reasoning";
import { streamModelCall } from "./model-call";
import { langfuseConfig } from "../observability/langfuse";
import { TurnTrace, type TraceParent } from "../observability/turn-trace";
import { resolveTurnLLM } from "./turn-llm";

export type { StreamEvent, ToolCallRecord } from "./types";
export { generateSessionTitle } from "./session-title";

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
 *
 * Options (eval runner): `traceParent` nests the turn's trace under that span;
 * `costBudget` is checked before each model call and charged with every priced
 * call (cost-budget.ts); running out fails the turn with `budget_exceeded`.
 * `llm` overrides model, effort and max_output_tokens for this turn
 * (turn-llm.ts); pricing, trace generations, chat_turns and usage_events all
 * use the effective settings. Without it the turn uses app config.
 */
export interface ProcessChatOptions {
  traceParent?: TraceParent;
  costBudget?: CostBudget;
  llm?: TurnLLMOverride;
}

export async function* processChat(
  sessionId: string,
  userId: string,
  userMessage: string,
  signal?: AbortSignal,
  options: ProcessChatOptions = {}
): AsyncGenerator<StreamEvent> {
  const chatElapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId, user_id: userId };
  const { llmConfig, providerOptions, transcriptTag, generationParameters } = resolveTurnLLM(options.llm);
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

  const meter = new UsageMeter(llmConfig.provider, llmConfig.chatModel, ctx);
  const tracker = new CallTracker(llmConfig.maxContextTokens);
  const budget = new TurnBudget(options.costBudget);
  let ledgerWritten = false;
  const turnAbort = new AbortController();
  const turnSignal = signal ? AbortSignal.any([signal, turnAbort.signal]) : turnAbort.signal;
  const drained = registerActiveTurn(turnAbort);
  let failure: TurnFailure | undefined;
  let turnId: string | null = null;
  let trace = TurnTrace.disabled;
  let loopIteration = 0;
  const signals = { finalFinishReason: null as string | null, toolErrorCount: 0 };
  let releaseLock: (() => void) | null = null;

  try {
    const session = chatSessionQueries.findById(sessionId);
    if (session && session.user_id !== userId) {
      logger.warn("CHAT", "session_unauthorized", { ctx, data: { session_owner: session.user_id } });
      yield { type: "error", data: { error: "Unauthorized: session belongs to another user" } };
      return;
    }

    releaseLock = acquireSessionLock(sessionId);
    if (!releaseLock) {
      logger.warn("CHAT", "turn_in_progress", { ctx });
      yield { type: "error", data: { error: TURN_IN_PROGRESS_MESSAGE, code: "turn_in_progress" } };
      return;
    }

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

    const turn = startTurn(sessionId, userMessage, session ? null : userId);
    if (!session) logger.info("CHAT", "session_created", { ctx });
    turnId = turn.turnId;
    ctx.turn_id = turnId;
    logger.info("CHAT", "turn_started", { ctx, data: { turn_id: turnId, turn_gap_seconds: turnGapSeconds } });
    trace = TurnTrace.start({
      turnId,
      sessionId,
      userId,
      userMessage,
      provider: llmConfig.provider,
      model: llmConfig.chatModel,
      traceParent: options.traceParent,
      metadata: {
        effort: llmConfig.effort,
        context_version: transcriptTag.contextVersion,
        turn_gap_seconds: turnGapSeconds,
        replayed_messages: messages.length,
      },
    });
    recordTraceId(turnId, trace.traceId, ctx);
    let tracedUpTo = messages.length;

    const send = (...added: ModelMessage[]) => {
      messages.push(...added);
      appendTranscript(sessionId, turn.turnId, added, transcriptTag);
    };
    send({ role: "user", content: userMessage });

    yield { type: "start", data: { sessionId } };

    if (toolRegistry.availableCount === 0) {
      logger.error("CHAT", "no_tools_available", { ctx });
      throw new TurnError("no_tools_available", "No MCP tools available. All database servers may be down.");
    }

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
    trace.setMetadata({ loaded_tools: Object.keys(activeTools).length - deferredCount, deferred_tools: deferredCount });

    let continueLoop = true;
    let persistedAssistantText = "";
    const reasoningBlocks: string[] = [];
    const allToolCalls: ToolCallRecord[] = [];
    const caching = llmConfig.provider === "anthropic";
    const instructions = caching ? cachedInstructions(SYSTEM_PROMPT) : SYSTEM_PROMPT;
    let previousLastIndex = history.previousLastIndex;
    if (previousLastIndex !== undefined && history.previousPromptTokens !== undefined) {
      tracker.carryOver(history.previousPromptTokens, previousLastIndex + 1);
    }

    while (continueLoop) {
      turnSignal.throwIfAborted();
      if (loopIteration >= llmConfig.maxToolIterations) {
        throw new TurnError("max_tool_iterations", `Maximum tool iterations exceeded (${llmConfig.maxToolIterations})`);
      }
      budget.check();
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

      const declarationTools = toDeclarations(activeTools);
      const callLastIndex = messages.length - 1;
      const gen = trace.generation({
        iteration: loopIteration,
        model: llmConfig.chatModel,
        input: langfuseConfig.full_generation_input ? messages : messages.slice(tracedUpTo),
        modelParameters: generationParameters,
        metadata: { message_count: messages.length, active_tools: Object.keys(activeTools).length },
      });
      tracedUpTo = messages.length;
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
          onFirstChunk: () => gen.firstChunk(),
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
      budget.chargeCall(call.costPicoUsd);
      signals.finalFinishReason = finishReason;
      if (loopIteration === 1) {
        logger.info("CHAT", "first_call_cache_read", {
          ctx,
          data: { first_call_cache_read: call.cacheReadTokens, turn_gap_seconds: turnGapSeconds },
        });
        trace.setMetadata({ first_call_cache_read: call.cacheReadTokens });
      }
      // The SDK's response messages as returned: they keep provider metadata
      // (thinking signatures, redacted thinking, Gemini thought signatures)
      // the model requires on later calls. Tool results come from our own
      // dispatch below, so the SDK's tool messages are skipped. The final
      // call's message is kept too: the next turn's cache prefix ends with it.
      send(...finalStep.response.messages.filter((msg) => msg.role !== "tool"));
      const traced = {
        call,
        finishReason,
        rawFinishReason,
        text: callText,
        reasoning: joinReasoning(callSegments.filter((seg) => seg.thinking).map((seg) => seg.text)),
        toolCalls: (toolCalls ?? []).map((tc) => ({ name: tc.toolName, input: tc.input })),
      };
      if (finishReason === "content-filter") {
        const refusal = refusalError(rawFinishReason, finalStep.providerMetadata);
        gen.fail(traced, refusal.message);
        throw refusal;
      }
      gen.finish(traced);
      previousLastIndex = callLastIndex;
      const isToolCall = finishReason === "tool-calls" && toolCalls && toolCalls.length > 0;
      for (const seg of callSegments) {
        if (seg.thinking || isToolCall) reasoningBlocks.push(seg.text);
      }

      if (isToolCall) {
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
          trace,
        };

        for (const tc of toolCalls) {
          turnSignal.throwIfAborted();
          const { record, part } = yield* dispatchToolCall(tc, dispatch);
          if (record) allToolCalls.push(record);
          if (part.output.type === "error-text") signals.toolErrorCount++;
          toolResultParts.push(part);
        }

        send({ role: "tool", content: toolResultParts });
      } else {
        if (callText) {
          persistedAssistantText = callText;
        }
        continueLoop = false;
      }
    }

    const chatCost = meter.summary();
    const assistantMsgId = recordOkTurn({
      meter,
      cost: chatCost,
      userId,
      sessionId,
      turnId: turn.turnId,
      provider: llmConfig.provider,
      model: llmConfig.chatModel,
      answer: persistedAssistantText,
      reasoning: joinReasoning(reasoningBlocks) || null,
      toolCalls: allToolCalls,
      iterations: loopIteration,
      lastPromptTokens: tracker.lastPromptTokens,
      ...signals,
    });
    ledgerWritten = true;
    trace.end({
      status: "ok",
      output: persistedAssistantText,
      metadata: { iterations: loopIteration, cost_usd: chatCost.costMicrousd / 1e6 },
    });
    scoreTurn(turn.turnId, ctx, trace.scoreObservationId);

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

    yield { type: "done", data: { messageId: assistantMsgId } };
    yield { type: "usage", data: { inputTokens: chatCost.inputTokens, outputTokens: chatCost.outputTokens } };
  } catch (error) {
    if (turnSignal.aborted) {
      const message = turnAbort.signal.aborted ? "Server shutting down" : "Client disconnected";
      failure = { code: "aborted", message, userMessage: "" };
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
    if (!ledgerWritten) {
      turnAbort.abort();
      const errorCode = failure?.code ?? "closed";
      const cutOffCall = recordFailedTurn({
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
      budget.reconcile(meter.summary().costPicoUsd);
      const errorMessage = failure?.message ?? "Consumer stopped reading before the turn finished";
      if (turnId) {
        finishFailedTurn(
          turnId,
          {
            status: errorCode === "aborted" || errorCode === "closed" ? "aborted" : "error",
            errorCode,
            errorMessage,
            iterations: loopIteration,
            ...signals,
          },
          ctx
        );
      }
      trace.end({
        status: errorCode === "aborted" || errorCode === "closed" ? errorCode : "error",
        errorCode,
        message: errorMessage,
        metadata: { iterations: loopIteration, cost_usd: meter.summary().costMicrousd / 1e6 },
        cutOffCall,
        tags: errorCode === "budget_exceeded" ? ["budget_exceeded"] : undefined,
      });
      if (turnId) scoreTurn(turnId, ctx, trace.scoreObservationId);
    }
    releaseLock?.();
    drained();
  }
}
