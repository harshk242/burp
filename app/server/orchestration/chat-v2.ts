/**
 * Chat Orchestration v2 — Model-Agnostic via Vercel AI SDK
 *
 * Owns the model loop, the SSE event stream and DB persistence. Tool dispatch,
 * large-output handling and the system prompt live in their own modules.
 */

import { streamText, generateText, type ModelMessage, type ToolResultPart } from "ai";
import { v4 as uuidv4 } from "uuid";
import { chatProviderOptions, getChatModel, getTitleModel, loadLLMConfig, sanitizeToolName } from "../llm";
import { db, messageQueries, chatSessionQueries, userQueries, dailyUsageQueries, usageEventQueries } from "../db";
import { logger, startTimer, type LogContext } from "../logger";
import { getUtcDate, getUtcMonth } from "../usage";
import { SYSTEM_PROMPT } from "./context/system-prompt";
import { applyCacheMarkers, cachedInstructions } from "./context/cache-markers";
import { toolRegistry } from "../mcp/registry";
import { buildToolCatalog, countDeferred } from "./context/tool-catalog";
import { dispatchToolCall, toDeclarations, type DispatchContext } from "./tool-dispatch";
import type { StreamEvent, ToolCallRecord } from "./types";
import { UsageMeter } from "./usage-meter";
import { CallTracker, recordFailedTurn, type TurnErrorCode } from "./turn-usage";

export type { StreamEvent, ToolCallRecord } from "./types";

const llmConfig = loadLLMConfig();
// Thinking + effort (Anthropic); undefined on Google.
const providerOptions = chatProviderOptions(llmConfig);

interface DBMessage {
  id: string;
  chat_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  created_at: number;
}

function buildMessages(history: DBMessage[], newMessage: string): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const msg of history) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content || "" });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content || "" });
    }
  }
  messages.push({ role: "user", content: newMessage });
  return messages;
}

// ── Main Chat Loop ─────────────────────────────────────────────────────────

/**
 * `signal` is aborted when the client disconnects: the in-flight LLM call and
 * tool calls are cancelled, no further iterations run, and no assistant message
 * is persisted. The same happens when the consumer stops iterating before the
 * turn completed (e.g. an SSE write threw). A failed or aborted turn still
 * records the cost of its LLM calls (status "error", see turn-usage.ts).
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
  const tracker = new CallTracker();
  // Set once the success path wrote its usage_events row.
  let ledgerWritten = false;
  // The turn's own signal: follows the caller's, and is aborted in `finally` so
  // an early return() by the consumer also cancels the in-flight LLM/tool call.
  const turnAbort = new AbortController();
  const turnSignal = signal ? AbortSignal.any([signal, turnAbort.signal]) : turnAbort.signal;
  // How the turn failed; stays "closed" if the consumer stopped iterating early.
  let errorCode: TurnErrorCode = "closed";

  try {
    // Session check
    let session = chatSessionQueries.findById(sessionId) as { id: string; user_id: string } | null;
    if (session) {
      if (session.user_id !== userId) {
        logger.warn("CHAT", "session_unauthorized", { ctx, data: { session_owner: session.user_id } });
        yield { type: "error", data: { error: "Unauthorized: session belongs to another user" } };
        return;
      }
    } else {
      chatSessionQueries.create(sessionId, userId, null);
      session = { id: sessionId, user_id: userId };
      logger.info("CHAT", "session_created", { ctx });
    }

    yield { type: "start", data: { sessionId } };

    // History + messages
    const history = messageQueries.findByChatId(sessionId) as DBMessage[];
    const messages = buildMessages(history, userMessage);

    // Store user message
    const userMsgId = uuidv4();
    messageQueries.create(userMsgId, sessionId, "user", userMessage, null);

    // All servers down: checked on availability, not on the tool list, which
    // (on Anthropic) declares every registered tool whether available or not.
    if (toolRegistry.availableCount === 0) {
      logger.error("CHAT", "no_tools_available", { ctx });
      yield { type: "error", data: { error: "No MCP tools available. All database servers may be down." } };
      return;
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
    let fullAssistantContent = "";
    let persistedAssistantText = ""; // final response text only (last iteration)
    let reasoningText = "";           // thinking (all iterations) + pre-tool-call text (non-final iterations)
    const allToolCalls: ToolCallRecord[] = [];
    let loopIteration = 0;
    // Prompt caching (Anthropic only): instructions carry the tools + system
    // breakpoint; message breakpoints go on a per-call copy (cache-markers.ts).
    const caching = llmConfig.provider === "anthropic";
    const instructions = caching ? cachedInstructions(SYSTEM_PROMPT) : SYSTEM_PROMPT;
    // Index of the previous call's last message in `messages`; unset on the first call.
    let previousLastIndex: number | undefined;

    while (continueLoop) {
      turnSignal.throwIfAborted();
      loopIteration++;
      if (loopIteration > llmConfig.maxToolIterations) {
        throw new Error(`Maximum tool iterations exceeded (${llmConfig.maxToolIterations})`);
      }
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

      // A provider error part does not make the stream throw: the SDK emits an
      // error part, hands it to onError and finishes the step with finishReason "error".
      let streamError: unknown;
      tracker.begin(loopIteration);
      const callLastIndex = messages.length - 1;
      const result = streamText({
        model: getChatModel({ fetch: tracker.fetch }),
        instructions,
        messages: caching ? applyCacheMarkers(messages, previousLastIndex) : messages,
        tools: declarationTools,
        maxRetries: llmConfig.maxRetries,
        maxOutputTokens: llmConfig.maxOutputTokens,
        providerOptions,
        abortSignal: turnSignal,
        onLanguageModelCallStart: tracker.onRequest,
        onChunk: tracker.onChunk,
        onError: ({ error }) => {
          streamError ??= error;
        },
      });

      // Stream text and thinking. Thinking (summarized on Anthropic) is sent as
      // `reasoning` events; separate thinking blocks in one call get a blank line.
      let callReasoning = "";
      let newReasoningBlock = false;
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          fullAssistantContent += part.text;
          yield { type: "text", data: part.text };
        } else if (part.type === "reasoning-start") {
          newReasoningBlock = callReasoning !== "";
        } else if (part.type === "reasoning-delta" && part.text) {
          const chunk = (newReasoningBlock ? "\n\n" : "") + part.text;
          newReasoningBlock = false;
          callReasoning += chunk;
          // An object, so the client's JSON.parse never turns a chunk like "42" into a number.
          yield { type: "reasoning", data: { text: chunk } };
        } else if (part.type === "error") {
          streamError ??= part.error;
        }
      }
      // An abort can end the text stream without an error; stop before
      // reading the step's results.
      turnSignal.throwIfAborted();
      // A failed call has no valid final usage: throw before metering it, so
      // the tracker keeps it in flight and the turn records it as an estimate.
      // Checked before awaiting the results, which would reject with a generic
      // NoOutputGeneratedError when the call produced nothing.
      if (streamError !== undefined) throw streamError;

      // Await the promise-based properties
      const finishReason = await result.finishReason;
      if (finishReason === "error") throw new Error(`LLM call ${loopIteration} finished with an error`);
      const toolCalls = await result.toolCalls;
      const finalStep = await result.finalStep;

      const call = meter.record(finalStep.usage, finalStep.providerMetadata, {
        iteration: loopIteration,
        durationMs: iterElapsed(),
        finishReason,
        toolCalls: toolCalls?.length ?? 0,
        toolNames: Object.keys(declarationTools),
        systemPrompt: SYSTEM_PROMPT,
      });
      tracker.finish(call);
      previousLastIndex = callLastIndex;
      // Thinking comes before this call's text, in the stored reasoning too.
      if (callReasoning) reasoningText += (reasoningText ? "\n\n" : "") + callReasoning;

      if (finishReason === "tool-calls" && toolCalls && toolCalls.length > 0) {
        // This iteration's text is reasoning (pre-tool-call).
        // Signal the client to reclassify it, then accumulate into reasoningText.
        if (fullAssistantContent) {
          yield { type: "text_block_end", data: { isReasoning: true } };
          reasoningText += (reasoningText ? "\n\n" : "") + fullAssistantContent;
        }
        // Reset text for next iteration (already streamed via SSE)
        fullAssistantContent = "";

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

        // Use SDK response messages for assistant turn — preserves
        // provider metadata (Gemini 3 thought signatures) that the model
        // requires on subsequent turns.
        const { messages: responseMessages } = finalStep.response;
        // SDK response messages may include tool-result messages. We execute
        // tools manually for SSE/control, so only keep assistant metadata here.
        messages.push(...responseMessages.filter((msg) => msg.role !== "tool"));

        // Append our manually constructed tool results
        messages.push({ role: "tool", content: toolResultParts });
      } else {
        // Final iteration — this text is the actual response.
        if (fullAssistantContent) {
          persistedAssistantText = fullAssistantContent;
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
        reasoningText || null,
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
      errorCode = "aborted";
      logger.info("CHAT", "process_aborted", { ctx, duration_ms: chatElapsed(), data: { error_code: errorCode } });
      return;
    }
    errorCode = "error";
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("CHAT", "process_failed", {
      ctx,
      duration_ms: chatElapsed(),
      error: error instanceof Error ? error : errorMsg,
      data: { error_code: errorCode },
    });
    yield { type: "error", data: { error: errorMsg } };
  } finally {
    // Errors, aborts and an early return() by the consumer all end here; the
    // calls that already ran are billed either way. Cancel whatever is still in
    // flight first, so the cut-off estimate covers exactly what was streamed.
    // Never throws.
    if (!ledgerWritten) {
      turnAbort.abort();
      recordFailedTurn({
        meter,
        tracker,
        userId,
        sessionId,
        provider: llmConfig.provider,
        model: llmConfig.chatModel,
        ctx,
        errorCode,
      });
    }
  }
}

// ── Title Generation ───────────────────────────────────────────────────────

export async function generateSessionTitle(
  sessionId: string,
  firstMessage: string
): Promise<string> {
  const fallbackTitle = buildFallbackTitle(firstMessage);
  const elapsed = startTimer();
  const ctx: LogContext = { session_id: sessionId };

  logger.info("TITLE", "generation_start", {
    ctx,
    data: { model: llmConfig.titleModel, provider: llmConfig.provider },
  });

  try {
    const { text } = await generateText({
      model: getTitleModel(),
      maxOutputTokens: 50,
      prompt: `Generate a short chat title (3-6 words) from this user question:
"${firstMessage.substring(0, 300)}"

Return only the title text.`,
      abortSignal: AbortSignal.timeout(5000),
    });

    const title = normalizeTitle(text, fallbackTitle);
    chatSessionQueries.updateTitle(sessionId, title);

    logger.info("TITLE", "generation_complete", {
      ctx,
      duration_ms: elapsed(),
      data: { title },
    });

    return title;
  } catch (error) {
    logger.error("TITLE", "generation_failed", {
      ctx,
      duration_ms: elapsed(),
      error: error instanceof Error ? error : String(error),
      data: { fallback_title: fallbackTitle },
    });
    chatSessionQueries.updateTitle(sessionId, fallbackTitle);
    return fallbackTitle;
  }
}

function normalizeTitle(rawTitle: string, fallback: string): string {
  const normalized = rawTitle
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!normalized) return fallback;
  return normalized.length > 80 ? normalized.slice(0, 80).trimEnd() : normalized;
}

function buildFallbackTitle(firstMessage: string): string {
  const cleaned = firstMessage
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) return "New Chat";
  const words = cleaned.split(" ").slice(0, 6);
  const title = words.join(" ");
  return title.length > 80 ? title.slice(0, 80).trimEnd() : title;
}
