/**
 * Usage of failed and aborted turns. Calls that finished before a turn threw or
 * was aborted were billed by the provider, so they still get a usage_events row
 * (`status: "error"`) and budgets never undercount. A call cut off mid-stream
 * has no final usage; it is recorded as an estimate and the row is flagged
 * `usage_estimated = 1`.
 */

import {
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelCallStartEvent,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import { v4 as uuidv4 } from "uuid";
import { db, dailyUsageQueries, usageEventQueries } from "../db";
import { estimateTokens, logger, type LogContext } from "../logger";
import { getUtcDate, getUtcMonth, type CallCost, type CallUsage } from "../usage";
import type { UsageMeter } from "./usage-meter";

/** How a turn ended without writing its normal ledger row. */
export type TurnErrorCode = "aborted" | "error" | "closed";

interface CallInFlight {
  iteration: number;
  /**
   * The request left and the provider accepted it: the model's `doStream`
   * resolved, i.e. the provider answered the HTTP request with a response
   * stream. Set at the model boundary (see `wrap`), not on the SDK's
   * `start-step` part: the SDK withholds that until the first part after
   * `stream-start`, so a call cut off right after being accepted would be
   * missed. A call cut off before (connect error, rejected request, abort while
   * sending) is not billed and gets no estimate.
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
  /** Serialized tool declarations as sent. */
  tools: Set<string>;
}

const serializeTools = (request: LanguageModelCallStartEvent | undefined): string[] =>
  (request?.tools ?? []).map((tool) => JSON.stringify(tool));

/** Follows the in-flight LLM call so a cut-off one can be estimated. */
export class CallTracker {
  private current: CallInFlight | null = null;
  private previous: PreviousCall | null = null;

  /** Call right before `streamText`. */
  begin(iteration: number): void {
    this.current = { iteration, sent: false, streamedChars: 0 };
  }

  /** The model to pass to `streamText`: marks the call sent once `doStream` resolves. */
  wrap(model: LanguageModel): LanguageModel {
    if (typeof model === "string") throw new Error("CallTracker.wrap needs a model instance, not a model id");
    return wrapLanguageModel({
      model,
      middleware: {
        wrapStream: async ({ doStream }) => {
          const result = await doStream();
          if (this.current) this.current.sent = true;
          return result;
        },
      },
    });
  }

  /** `streamText({ onLanguageModelCallStart })`. */
  readonly onRequest = (event: LanguageModelCallStartEvent): void => {
    if (this.current) this.current.request = event;
  };

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

  /** The in-flight call finished and was recorded by the meter. */
  finish(call: CallCost): void {
    const request = this.current?.request;
    this.previous = {
      promptTokens: call.promptTokens,
      messageCount: request?.messages.length ?? 0,
      instructions: JSON.stringify(request?.instructions) ?? "",
      tools: new Set(serializeTools(request)),
    };
    this.current = null;
  }

  /**
   * Estimate for a call that was sent but never finished, or null. Input is the
   * previous call's prompt plus what was added since: new messages, tool
   * declarations not sent before (search activates tools mid-turn) and the
   * instructions if they changed. Nothing is subtracted for removed parts, so
   * the estimate never falls below the growth. On a turn's first call it is the
   * whole request (instructions, messages, tools). All of it is priced as
   * uncached input (the worst case). Output is streamed characters / 4.
   */
  estimateCutOffCall(): { iteration: number; usage: CallUsage } | null {
    const call = this.current;
    if (!call?.sent || !call.request) return null;
    const { instructions, messages, tools } = call.request;
    const inputTokens = this.previous
      ? this.previous.promptTokens + this.estimateGrowth(call.request, this.previous)
      : estimateTokens(JSON.stringify({ instructions, messages, tools }));
    return {
      iteration: call.iteration,
      usage: {
        noCacheTokens: inputTokens,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        outputTokens: Math.ceil(call.streamedChars / 4),
      },
    };
  }

  private estimateGrowth(request: LanguageModelCallStartEvent, previous: PreviousCall): number {
    const newTools = serializeTools(request).filter((tool) => !previous.tools.has(tool));
    const instructions = JSON.stringify(request.instructions) ?? "";
    return (
      estimateTokens(JSON.stringify(request.messages.slice(previous.messageCount))) +
      (newTools.length > 0 ? estimateTokens(`[${newTools.join(",")}]`) : 0) +
      (instructions !== previous.instructions ? estimateTokens(instructions) : 0)
    );
  }
}

export interface FailedTurn {
  meter: UsageMeter;
  tracker: CallTracker;
  userId: string;
  sessionId: string;
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
 * Never throws: a failure here must not mask the turn's own error.
 */
export function recordFailedTurn(turn: FailedTurn): void {
  const { meter, ctx, errorCode } = turn;
  try {
    const cutOff = turn.tracker.estimateCutOffCall();
    if (cutOff) {
      const call = meter.add(cutOff.usage, { estimated: true });
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
    if (meter.callCount === 0) return;

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
      });
      dailyUsageQueries.incrementTokens(turn.userId, cost.inputTokens, cost.outputTokens);
    });

    logger.info("CHAT", "failed_turn_usage_recorded", {
      ctx,
      data: { usage_event_id: usageEventId, status: "error", error_code: errorCode, ...meter.logFields(cost) },
    });
  } catch (error) {
    logger.error("CHAT", "failed_turn_usage_record_failed", {
      ctx,
      error: error instanceof Error ? error : String(error),
      data: { error_code: errorCode, llm_calls: meter.callCount },
    });
  }
}
