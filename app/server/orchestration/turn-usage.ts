import type { LanguageModelCallStartEvent, TextStreamPart, ToolSet } from "ai";
import { v4 as uuidv4 } from "uuid";
import { db, chatSessionQueries, chatTurnQueries, dailyUsageQueries, messageQueries, usageEventQueries, userQueries } from "../db";
import { estimateTokens, logger, type LogContext } from "../logger";
import { getUtcDate, getUtcMonth, type CallCost, type CallUsage, type ChatCost } from "../usage";
import { usageRecovery } from "./usage-reconciliation";
import type { ChatTurnOutcome } from "../db";
import { TurnError, type TurnErrorCode } from "./chat-turn";
import { stripCacheMarkers } from "./context/transcript";
import type { ToolCallRecord } from "./types";
import type { UsageMeter } from "./usage-meter";

interface CallInFlight {
  iteration: number;
  state: "prepared" | "attempted" | "accepted" | "rejected" | "completed";
  streamedChars: number;
  request?: LanguageModelCallStartEvent;
}

interface PreviousCall {
  promptTokens: number;
  messageCount: number;
  instructions: string;
  tools: Set<string>;
  identity: string;
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

export function inputIdentity(request: LanguageModelCallStartEvent, messageCount = request.messages.length): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify({
    provider: request.provider, model: request.modelId, instructions: request.instructions,
    tools: request.tools, messages: request.messages.slice(0, messageCount).map(stripCacheMarkers),
  })).digest("hex");
}

export class CallTracker {
  private current: CallInFlight | null = null;
  private previous: PreviousCall | null = null;
  private carried: { promptTokens: number; messageCount: number; identity?: string } | null = null;

  constructor(private readonly maxContextTokens = Infinity) {}

  carryOver(promptTokens: number, messageCount: number, identity?: string): void {
    this.carried = { promptTokens, messageCount, identity };
  }

  get lastPromptTokens(): number | undefined {
    return this.previous?.promptTokens;
  }

  get lastInputMessageCount(): number | undefined { return this.previous?.messageCount; }
  get lastInputIdentity(): string | undefined { return this.previous?.identity; }

  get reconciliationState(): "none" | "estimated" | "uncertain" {
    return this.current?.state === "attempted" ? "uncertain" : this.current?.state === "accepted" ? "estimated" : "none";
  }

  begin(iteration: number): void {
    this.current = { iteration, state: "prepared", streamedChars: 0 };
  }

  readonly fetch: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const call = this.current;
      if (call) call.state = "attempted";
      const res = await globalThis.fetch(input, init);
      if (call) call.state = res.ok ? "accepted" : "rejected";
      return res;
    },
    { preconnect: (...args: Parameters<typeof fetch.preconnect>) => globalThis.fetch.preconnect(...args) }
  );

  readonly onRequest = (event: LanguageModelCallStartEvent): void => {
    if (this.current) this.current.request = event;
  };

  /** SDK notification callbacks swallow errors. */
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

  finish(call: CallCost): void {
    const request = this.current?.request;
    this.previous = {
      promptTokens: call.promptTokens,
      messageCount: request?.messages.length ?? 0,
      instructions: JSON.stringify(request?.instructions) ?? "",
      tools: new Set(loadedTools(request)),
      identity: request ? inputIdentity(request) : "",
    };
    if (this.current) this.current.state = "completed";
    this.current = null;
  }

  estimateCutOffCall(cacheWrites = false): { iteration: number; usage: CallUsage } | null {
    const call = this.current;
    if (!call || !["attempted", "accepted"].includes(call.state) || !call.request) return null;
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
    if (!carried || carried.messageCount > request.messages.length ||
      carried.identity !== inputIdentity(request, carried.messageCount)) return null;
    return {
      identity: carried.identity,
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
  turnId: string | null;
  provider: string;
  model: string;
  ctx: LogContext;
  errorCode: TurnErrorCode;
  outcome?: ChatTurnOutcome;
}

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
          reconciliation_state: turn.tracker.reconciliationState,
          error_code: errorCode,
          prompt_tokens: call.promptTokens,
          output_tokens: call.outputTokens,
          pricing_tier: call.tier,
          call_cost_microusd: call.costPicoUsd / 1_000_000,
        },
      });
    }
    const cost = meter.summary();
    const usageEventId = uuidv4();
    usageRecovery.submit({
      id: usageEventId,
      turnId: turn.turnId,
      outcome: turn.outcome,
      event: meter.callCount === 0 ? undefined : {
        id: usageEventId, user_id: turn.userId, date: getUtcDate(), month: getUtcMonth(),
        operation: "chat", provider: turn.provider, model: turn.model,
        ...meter.ledgerFields(cost), status: "error", session_id: turn.sessionId,
        message_id: null, turn_id: turn.turnId, reconciliation_state: turn.tracker.reconciliationState,
      },
    });

    logger.info("CHAT", "failed_turn_usage_submitted", {
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
  lastInputMessageCount?: number;
  lastInputIdentity?: string;
  finalFinishReason: string | null;
  toolErrorCount: number;
}

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
      lastInputMessageCount: turn.lastInputMessageCount,
      lastInputIdentity: turn.lastInputIdentity,
      finalFinishReason: turn.finalFinishReason,
      toolErrorCount: turn.toolErrorCount,
    });

    chatSessionQueries.touch(turn.sessionId);
    userQueries.incrementQueries(turn.userId);
    dailyUsageQueries.incrementTokens(turn.userId, cost.inputTokens, cost.outputTokens);
  });
  return assistantMsgId;
}
