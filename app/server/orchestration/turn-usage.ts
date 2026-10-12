/**
 * Usage of failed and aborted turns. Calls that finished before a turn threw or
 * was aborted were billed by the provider, so they still get a usage_events row
 * (`status: "error"`) and budgets never undercount. A call cut off mid-stream
 * has no final usage; it is recorded as an estimate and the row is flagged
 * `usage_estimated = 1`.
 */

import type { LanguageModelCallStartEvent, TextStreamPart, ToolSet } from "ai";
import { v4 as uuidv4 } from "uuid";
import { db, dailyUsageQueries, usageEventQueries } from "../db";
import { estimateTokens, logger, type LogContext } from "../logger";
import { getUtcDate, getUtcMonth, type CallCost, type CallUsage } from "../usage";
import { TurnError, type TurnErrorCode } from "./chat-turn";
import type { UsageMeter } from "./usage-meter";

interface CallInFlight {
  iteration: number;
  /**
   * The request left and the provider accepted it: the HTTP response came back
   * with a 2xx status. Set at the transport boundary (see `fetch`), not when the
   * model's `doStream` resolves or on the SDK's `start-step` part: providers
   * (the Anthropic adapter) wait for the first SSE data before resolving
   * `doStream`, so a call cut off after the 200 but before any data would be
   * missed. A call cut off before (connect error, abort while sending) or
   * rejected (429/529, also retried attempts) is not billed and gets no
   * estimate.
   */
  sent: boolean;
  /** Output streamed so far: text, reasoning and tool-call input. */
  streamedChars: number;
  /** The prompt as the SDK was about to send it. */
  request?: LanguageModelCallStartEvent;
}

/** What the last finished call's prompt was made of, to size the next call's growth. */
interface PreviousCall {
  promptTokens: number;
  messageCount: number;
  /** Serialized instructions as sent. */
  instructions: string;
  /** Serialized tool definitions in context (see `loadedTools`). */
  tools: Set<string>;
}

type PreparedTool = Record<string, unknown> & {
  name?: unknown;
  providerOptions?: { anthropic?: { deferLoading?: unknown } };
};

/**
 * Serialized definitions of the tools whose definition is in the prompt: every
 * declared tool except deferred ones (Anthropic), plus the deferred tools a
 * tool search referenced so far, whose definitions the provider expands at the
 * reference. An undiscovered deferred tool costs (almost) nothing.
 */
function loadedTools(request: LanguageModelCallStartEvent | undefined): string[] {
  if (!request) return [];
  const referenced = referencedToolNames(request.messages);
  return (request.tools ?? [])
    .filter((tool) => {
      const t = tool as PreparedTool;
      return t.providerOptions?.anthropic?.deferLoading !== true || referenced.has(String(t.name));
    })
    .map((tool) => JSON.stringify(tool));
}

/** Names in `tool-reference` parts of tool results (search_available_tools on Anthropic). */
function referencedToolNames(messages: LanguageModelCallStartEvent["messages"]): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result" || part.output.type !== "content") continue;
      for (const item of part.output.value) {
        const ref = item.type === "custom" ? item.providerOptions?.anthropic : undefined;
        if (ref?.type === "tool-reference" && typeof ref.toolName === "string") names.add(ref.toolName);
      }
    }
  }
  return names;
}

/** Follows the in-flight LLM call so a cut-off one can be estimated. */
export class CallTracker {
  private current: CallInFlight | null = null;
  private previous: PreviousCall | null = null;
  /** The preceding turn's last call, measured: its prompt was the first `messageCount` replayed messages. */
  private carried: { promptTokens: number; messageCount: number } | null = null;

  constructor(private readonly maxContextTokens = Infinity) {}

  /**
   * Seeds the turn's first estimate with the preceding turn's measured last
   * prompt, so it is that number plus what was added since (its final answer
   * and the new user message) instead of a character count of the whole
   * history. Only valid when the replayed prefix is byte-identical to that
   * call's input (a lossless, compatible turn).
   */
  carryOver(promptTokens: number, messageCount: number): void {
    this.carried = { promptTokens, messageCount };
  }

  /** Measured prompt of the last finished call in this turn. */
  get lastPromptTokens(): number | undefined {
    return this.previous?.promptTokens;
  }

  /** Call right before `streamText`. */
  begin(iteration: number): void {
    this.current = { iteration, sent: false, streamedChars: 0 };
  }

  /**
   * The provider's `fetch` (`getChatModel({ fetch })`): marks the in-flight call
   * sent once the provider answered with a 2xx response. Per tracker, so it must
   * go on a per-turn provider instance, never a shared one.
   */
  readonly fetch: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const res = await globalThis.fetch(input, init);
      if (res.ok && this.current) this.current.sent = true;
      return res;
    },
    { preconnect: (...args: Parameters<typeof fetch.preconnect>) => globalThis.fetch.preconnect(...args) }
  );

  /** `streamText({ onLanguageModelCallStart })`. */
  readonly onRequest = (event: LanguageModelCallStartEvent): void => {
    if (this.current) this.current.request = event;
  };

  /** SDK notification callbacks swallow errors; enforce at the model boundary. */
  assertContextBudget(): void {
    const request = this.current?.request;
    if (request && this.estimateInputTokens(request) > this.maxContextTokens) {
      throw new TurnError("context_budget", "this chat is too long, start a new chat");
    }
  }

  /** Prepared input, including instructions and definitions actually loaded. */
  estimateInputTokens(request: LanguageModelCallStartEvent): number {
    const previous = this.previous ?? this.carriedCall(request);
    return previous
      ? previous.promptTokens + this.estimateGrowth(request, previous)
      : estimateTokens(JSON.stringify({ instructions: request.instructions, messages: request.messages })) + estimateToolTokens(loadedTools(request));
  }

  /** `streamText({ onChunk })`. */
  readonly onChunk = ({ chunk }: { chunk: TextStreamPart<ToolSet> }): void => {
    const call = this.current;
    if (!call) return;
    switch (chunk.type) {
      case "text-delta":
      case "reasoning-delta":
        call.streamedChars += chunk.text.length;
        break;
      case "tool-input-delta":
        call.streamedChars += chunk.delta.length;
        break;
    }
  };

  /**
   * The in-flight call finished and its final usage was recorded by the meter.
   * Only call it then: it drops the in-flight call, so a call that failed
   * (e.g. finished with an error part) and was finished anyway would get no
   * cut-off estimate.
   */
  finish(call: CallCost): void {
    const request = this.current?.request;
    this.previous = {
      promptTokens: call.promptTokens,
      messageCount: request?.messages.length ?? 0,
      instructions: JSON.stringify(request?.instructions) ?? "",
      tools: new Set(loadedTools(request)),
    };
    this.current = null;
  }

  /**
   * Estimate for a call that was sent but never finished, or null. Input is the
   * previous call's prompt plus what was added since: new messages, tool
   * definitions not in context before (Gemini search activates tools mid-turn;
   * on Anthropic a tool reference loads a deferred one) and the instructions if
   * they changed. Nothing is subtracted for removed parts, so the estimate never
   * falls below the growth. On a turn's first call it is the whole request
   * (instructions, messages, loaded tools). All of it is priced at the worst
   * case: a 5-minute cache write when the provider caches (`cacheWrites`,
   * 1.25× input on Anthropic), uncached input otherwise. Output is streamed
   * characters / 4.
   */
  estimateCutOffCall(cacheWrites = false): { iteration: number; usage: CallUsage } | null {
    const call = this.current;
    if (!call?.sent || !call.request) return null;
    const inputTokens = this.estimateInputTokens(call.request);
    return {
      iteration: call.iteration,
      usage: {
        noCacheTokens: cacheWrites ? 0 : inputTokens,
        cacheReadTokens: 0,
        cacheWrite5mTokens: cacheWrites ? inputTokens : 0,
        cacheWrite1hTokens: 0,
        outputTokens: Math.ceil(call.streamedChars / 4),
      },
    };
  }

  /**
   * The carried-over call as a PreviousCall. Instructions are taken as
   * unchanged (a changed system prompt changes context_version, which degrades
   * the turn and drops the carry-over); its loaded tools are the ones the
   * replayed prefix references, with today's definitions.
   */
  private carriedCall(request: LanguageModelCallStartEvent): PreviousCall | null {
    const carried = this.carried;
    if (!carried || carried.messageCount > request.messages.length) return null;
    return {
      promptTokens: carried.promptTokens,
      messageCount: carried.messageCount,
      instructions: JSON.stringify(request.instructions) ?? "",
      tools: new Set(loadedTools({ ...request, messages: request.messages.slice(0, carried.messageCount) })),
    };
  }

  private estimateGrowth(request: LanguageModelCallStartEvent, previous: PreviousCall): number {
    const newTools = loadedTools(request).filter((tool) => !previous.tools.has(tool));
    const instructions = JSON.stringify(request.instructions) ?? "";
    return (
      estimateTokens(JSON.stringify(request.messages.slice(previous.messageCount))) +
      estimateToolTokens(newTools) +
      (instructions !== previous.instructions ? estimateTokens(instructions) : 0)
    );
  }
}

const estimateToolTokens = (tools: string[]): number =>
  tools.length > 0 ? estimateTokens(`[${tools.join(",")}]`) : 0;

export interface FailedTurn {
  meter: UsageMeter;
  tracker: CallTracker;
  userId: string;
  sessionId: string;
  /** chat_turns row the cost belongs to; null when the turn never started. */
  turnId: string | null;
  provider: string;
  model: string;
  ctx: LogContext;
  errorCode: TurnErrorCode;
}

/**
 * Writes one `status: "error"` usage_events row for the calls a failed turn
 * already paid for (plus the estimate for a cut-off call); nothing when no call
 * was billed. There is no assistant message, so `message_id` is null. Daily
 * token totals are incremented like a successful turn; the query counters are
 * not (the daily count was taken by the rate limiter when the turn started).
 *
 * Returns the estimate added for a cut-off call, if any (the turn's trace puts
 * it on the cut-off generation). Never throws: a failure here must not mask
 * the turn's own error.
 */
export function recordFailedTurn(turn: FailedTurn): CallCost | undefined {
  const { meter, ctx, errorCode } = turn;
  let estimate: CallCost | undefined;
  try {
    // Anthropic turns request prompt caching (chat-v2), so new input may be cache-written.
    const cutOff = turn.tracker.estimateCutOffCall(turn.provider === "anthropic");
    if (cutOff) {
      const call = meter.add(cutOff.usage, { estimated: true });
      estimate = call;
      logger.warn("CHAT", "usage_estimated", {
        ctx,
        data: {
          iteration: cutOff.iteration,
          error_code: errorCode,
          prompt_tokens: call.promptTokens,
          output_tokens: call.outputTokens,
          pricing_tier: call.tier,
          call_cost_microusd: call.costPicoUsd / 1_000_000,
        },
      });
    }
    if (meter.callCount === 0) return estimate;

    const cost = meter.summary();
    const usageEventId = uuidv4();
    db.transaction(() => {
      usageEventQueries.create({
        id: usageEventId,
        user_id: turn.userId,
        date: getUtcDate(),
        month: getUtcMonth(),
        operation: "chat",
        provider: turn.provider,
        model: turn.model,
        ...meter.ledgerFields(cost),
        status: "error",
        session_id: turn.sessionId,
        message_id: null,
        turn_id: turn.turnId,
      });
      dailyUsageQueries.incrementTokens(turn.userId, cost.inputTokens, cost.outputTokens);
    });

    logger.info("CHAT", "failed_turn_usage_recorded", {
      ctx,
      data: {
        usage_event_id: usageEventId,
        turn_id: turn.turnId,
        status: "error",
        error_code: errorCode,
        ...meter.logFields(cost),
      },
    });
  } catch (error) {
    logger.error("CHAT", "failed_turn_usage_record_failed", {
      ctx,
      error: error instanceof Error ? error : String(error),
      data: { error_code: errorCode, llm_calls: meter.callCount },
    });
  }
  return estimate;
}
