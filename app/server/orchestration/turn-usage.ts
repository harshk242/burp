import type { LanguageModelCallStartEvent, TextStreamPart, ToolSet } from "ai";
import { v4 as uuidv4 } from "uuid";
import { db, chatSessionQueries, chatTurnQueries, dailyUsageQueries, messageQueries, usageEventQueries, userQueries } from "../db";
import { estimateTokens, logger, type LogContext } from "../logger";
import { getUtcDate, getUtcMonth, type CallCost, type CallUsage, type ChatCost } from "../usage";
import { TurnError, type TurnErrorCode } from "./chat-turn";
import type { ToolCallRecord } from "./types";
import type { UsageMeter } from "./usage-meter";

interface CallInFlight {
  iteration: number;
  sent: boolean;
  streamedChars: number;
  request?: LanguageModelCallStartEvent;
}

interface PreviousCall {
  promptTokens: number;
  messageCount: number;
  instructions: string;
  tools: Set<string>;
}

type PreparedTool = Record<string, unknown> & {
  name?: unknown;
  providerOptions?: { anthropic?: { deferLoading?: unknown } };
};

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

export class CallTracker {
  private current: CallInFlight | null = null;
  private previous: PreviousCall | null = null;
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

  get lastPromptTokens(): number | undefined {
    return this.previous?.promptTokens;
  }

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

  estimateInputTokens(request: LanguageModelCallStartEvent): number {
    const previous = this.previous ?? this.carriedCall(request);
    return previous
      ? previous.promptTokens + this.estimateGrowth(request, previous)
      : estimateTokens(JSON.stringify({ instructions: request.instructions, messages: request.messages })) + estimateToolTokens(loadedTools(request));
  }

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

export interface OkTurn {
  meter: UsageMeter;
  cost: ChatCost;
  userId: string;
  sessionId: string;
  turnId: string;
  provider: string;
  model: string;
  answer: string;
  reasoning: string | null;
  toolCalls: ToolCallRecord[];
  iterations: number;
  lastPromptTokens: number | null | undefined;
  finalFinishReason: string | null;
  toolErrorCount: number;
}

/**
 * The success path's ledger write, in one transaction: the assistant message
 * (tokens, cost, reasoning), its `status: "ok"` usage_events row, the finished
 * chat_turns row, and the session/user/daily counters. Returns the assistant
 * message id.
 */
export function recordOkTurn(turn: OkTurn): string {
  const { cost } = turn;
  const assistantMsgId = uuidv4();
  db.transaction(() => {
    messageQueries.create(
      assistantMsgId,
      turn.sessionId,
      "assistant",
      turn.answer,
      turn.toolCalls.length > 0 ? JSON.stringify(turn.toolCalls) : null,
      cost.inputTokens,
      cost.outputTokens,
      turn.reasoning,
      cost.costMicrousd
    );

    usageEventQueries.create({
      id: uuidv4(),
      user_id: turn.userId,
      date: getUtcDate(),
      month: getUtcMonth(),
      operation: "chat",
      provider: turn.provider,
      model: turn.model,
      ...turn.meter.ledgerFields(cost),
      status: "ok",
      session_id: turn.sessionId,
      message_id: assistantMsgId,
      turn_id: turn.turnId,
    });

    chatTurnQueries.finish(turn.turnId, {
      status: "ok",
      iterations: turn.iterations,
      assistantMessageId: assistantMsgId,
      lastPromptTokens: turn.lastPromptTokens,
      finalFinishReason: turn.finalFinishReason,
      toolErrorCount: turn.toolErrorCount,
    });

    chatSessionQueries.touch(turn.sessionId);
    userQueries.incrementQueries(turn.userId);
    dailyUsageQueries.incrementTokens(turn.userId, cost.inputTokens, cost.outputTokens);
  });
  return assistantMsgId;
}
