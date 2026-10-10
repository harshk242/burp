/**
 * Chat Orchestration v2 — Model-Agnostic via Vercel AI SDK
 *
 * Owns the model loop, the SSE event stream and DB persistence. Tool dispatch,
 * large-output handling and the system prompt live in their own modules.
 */

import { streamText, generateText, type ModelMessage, type ToolResultPart } from "ai";
import { v4 as uuidv4 } from "uuid";
import { getChatModel, getTitleModel, loadLLMConfig, sanitizeToolName } from "../llm";
import { db, messageQueries, chatSessionQueries, userQueries, dailyUsageQueries, usageEventQueries } from "../db";
import { logger, startTimer, type LogContext } from "../logger";
import { getUtcDate, getUtcMonth, priceCall, resolvePricing, summarizeTurnCost, type CallCost } from "../usage";
import { SYSTEM_PROMPT } from "./context/system-prompt";
import { buildInitialToolSet, dispatchToolCall, toDeclarations, type DispatchContext } from "./tool-dispatch";
import type { StreamEvent, ToolCallRecord } from "./types";

export type { StreamEvent, ToolCallRecord } from "./types";

const llmConfig = loadLLMConfig();

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
 * tool calls are cancelled, no further iterations run, and nothing is persisted
 * for the assistant turn.
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

    // Build tool set
    const activeTools = buildInitialToolSet(sanitize, llmConfig.provider);
    const coreToolCount = Object.keys(activeTools).length - 1; // exclude search_available_tools

    if (coreToolCount === 0) {
      logger.error("CHAT", "no_tools_available", { ctx });
      yield { type: "error", data: { error: "No MCP tools available. All database servers may be down." } };
      return;
    }

    logger.info("CHAT", "tools_loaded", {
      ctx,
      data: {
        core_tools: coreToolCount,
        total_tools: Object.keys(activeTools).length,
        provider: llmConfig.provider,
      },
    });

    let continueLoop = true;
    let fullAssistantContent = "";
    let persistedAssistantText = ""; // final response text only (last iteration)
    let reasoningText = "";           // pre-tool-call reasoning text (all non-final iterations)
    const allToolCalls: ToolCallRecord[] = [];
    let loopIteration = 0;
    // Token accumulators — summed across all tool-call iterations
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const callCosts: CallCost[] = [];

    while (continueLoop) {
      signal?.throwIfAborted();
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

      const result = streamText({
        model: getChatModel(),
        instructions: SYSTEM_PROMPT,
        messages,
        tools: declarationTools,
        maxRetries: llmConfig.maxRetries,
        maxOutputTokens: llmConfig.maxOutputTokens,
        abortSignal: signal,
      });

      // Stream text chunks
      for await (const chunk of result.textStream) {
        fullAssistantContent += chunk;
        yield { type: "text", data: chunk };
      }
      // An abort can end the text stream without an error; stop before
      // reading the step's results.
      signal?.throwIfAborted();

      // Await the promise-based properties
      const finishReason = await result.finishReason;
      const toolCalls = await result.toolCalls;
      const usage = await result.usage;
      const iterDuration = iterElapsed();

      // Accumulate token counts across all tool-call iterations
      totalInputTokens += usage?.inputTokens ?? 0;
      totalOutputTokens += usage?.outputTokens ?? 0;
      // Priced per call; all input at the uncached rate until the usage meter
      // splits out cache reads/writes.
      callCosts.push(
        priceCall(llmConfig.provider, llmConfig.chatModel, {
          noCacheTokens: usage?.inputTokens ?? 0,
          cacheReadTokens: 0,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          outputTokens: usage?.outputTokens ?? 0,
        })
      );

      logger.info("CHAT", "llm_response_received", {
        ctx,
        duration_ms: iterDuration,
        data: {
          iteration: loopIteration,
          finish_reason: finishReason,
          input_tokens: usage?.inputTokens,
          output_tokens: usage?.outputTokens,
          tool_calls: toolCalls?.length ?? 0,
        },
      });

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
        };

        for (const tc of toolCalls) {
          const { record, part } = yield* dispatchToolCall(tc, dispatch);
          if (record) allToolCalls.push(record);
          toolResultParts.push(part);
        }

        // Use SDK response messages for assistant turn — preserves
        // provider metadata (Gemini 3 thought signatures) that the model
        // requires on subsequent turns.
        const { messages: responseMessages } = (await result.finalStep).response;
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
          signal,

    const chatCost = summarizeTurnCost(callCosts);
    const baseRates = resolvePricing(llmConfig.provider, llmConfig.chatModel).base;
          signal?.throwIfAborted();

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
        totalInputTokens,
        totalOutputTokens,
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
        input_tokens: chatCost.inputTokens,
        output_tokens: chatCost.outputTokens,
        input_cost_per_mtok_microusd: baseRates.input,
        output_cost_per_mtok_microusd: baseRates.output,
        cost_microusd: chatCost.costMicrousd,
        session_id: sessionId,
        message_id: assistantMsgId,
      });

      chatSessionQueries.touch(sessionId);
      userQueries.incrementQueries(userId);
      // Increment daily token totals (best-effort: done post-response; next request checks these)
      dailyUsageQueries.incrementTokens(userId, totalInputTokens, totalOutputTokens);
    });

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
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        cost_microusd: chatCost.costMicrousd,
      },
    });

    // done arrives first so finalizeAssistantMessage() commits the message to
    // state.messages before the frontend's setLastMessageTokens runs.
    yield { type: "done", data: { messageId: assistantMsgId } };
    // usage arrives after done — safe to patch tokenUsage onto the last message
    yield { type: "usage", data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("CHAT", "process_failed", {
      ctx,
      duration_ms: chatElapsed(),
      error: error instanceof Error ? error : errorMsg,
    });
    yield { type: "error", data: { error: errorMsg } };
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
    if (signal?.aborted) {
      // Client is gone: nothing to stream an error to.
      logger.info("CHAT", "process_aborted", { ctx, duration_ms: chatElapsed() });
      return;
    }
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
