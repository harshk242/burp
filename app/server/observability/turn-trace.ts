import { LangfuseOtelSpanAttributes, startObservation, type LangfuseAgent, type LangfuseObservation, type ObservationLevel } from "@langfuse/tracing";
import { TraceFlags, type Attributes } from "@opentelemetry/api";
import type { CallCost } from "../usage";
import { logger } from "../logger";
import { tracingActive } from "./langfuse";

export type TurnTraceStatus = "ok" | "error" | "aborted" | "closed";

export interface TurnTraceStart {
  turnId: string;
  sessionId: string;
  userId: string;
  userMessage: string;
  provider: string;
  model: string;
  metadata?: Record<string, unknown>;
  /** Nest the turn under this span (same trace) instead of starting its own trace. */
  traceParent?: TraceParent;
}

export interface TraceParent {
  traceId: string;
  spanId: string;
}

export interface TurnTraceEnd {
  status: TurnTraceStatus;
  /** Final answer (ok turns). */
  output?: string;
  errorCode?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  /** Estimated usage of a call cut off mid-stream; goes on the generation still open. */
  cutOffCall?: CallCost;
  /** Added to the trace tags on the root (e.g. `budget_exceeded`). */
  tags?: string[];
}

export interface GenerationStart {
  iteration: number;
  model: string;
  /** Messages added since the previous call (or the full context when configured). */
  input: unknown;
  modelParameters?: Record<string, string | number>;
  metadata?: Record<string, unknown>;
}

export interface GenerationResult {
  call: CallCost;
  finishReason: string;
  rawFinishReason?: string;
  text: string;
  reasoning: string;
  toolCalls: { name: string; input: unknown }[];
}

export interface ToolStart {
  name: string;
  input: unknown;
  asType: "tool" | "retriever";
  metadata?: Record<string, unknown>;
}

export interface ToolResult {
  /** What the model saw. */
  output: unknown;
  metadata?: Record<string, unknown>;
}

const PICO_PER_USD = 1e12;

/** The trace id of a turn: hex sha256 of the turn id, first 32 chars. */
export function traceIdForTurn(turnId: string): string {
  return new Bun.CryptoHasher("sha256").update(turnId).digest("hex").slice(0, 32);
}

/** Our own usage and cost for one call; Langfuse never re-prices it. */
export function generationUsage(call: CallCost): { usageDetails: Record<string, number>; costDetails: Record<string, number> } {
  return {
    usageDetails: {
      input: call.noCacheTokens,
      output: call.outputTokens,
      cache_read_input_tokens: call.cacheReadTokens,
      cache_creation_input_tokens: call.cacheWrite5mTokens + call.cacheWrite1hTokens,
    },
    costDetails: {
      input: call.inputCostPicoUsd / PICO_PER_USD,
      output: call.outputCostPicoUsd / PICO_PER_USD,
      cache_read: call.cacheReadCostPicoUsd / PICO_PER_USD,
      cache_write: call.cacheWriteCostPicoUsd / PICO_PER_USD,
      total: call.costPicoUsd / PICO_PER_USD,
    },
  };
}

function warn(event: string, error: unknown): void {
  try {
    logger.warn("TRACE", event, { error: error instanceof Error ? error : String(error) });
  } catch {
  }
}

function safely<T>(event: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    warn(event, error);
    return fallback;
  }
}

abstract class Child {
  private done = false;

  constructor(
    protected readonly obs: LangfuseObservation | null,
    private readonly onDone: (child: Child) => void
  ) {}

  protected endOnce(event: string, apply: (obs: LangfuseObservation) => void): void {
    if (this.done) return;
    this.done = true;
    this.onDone(this);
    if (!this.obs) return;
    const obs = this.obs;
    safely(event, () => apply(obs), undefined);
    safely(event, () => obs.end(), undefined);
  }

  close(level: ObservationLevel, statusMessage: string): void {
    this.endOnce("child_close_failed", (obs) => obs.updateOtelSpanAttributes({ level, statusMessage }));
  }
}

export class GenerationObservation extends Child {
  /** Marks the first streamed chunk (completionStartTime). */
  firstChunk(): void {
    if (!this.obs) return;
    const obs = this.obs;
    safely("generation_first_chunk_failed", () => obs.updateOtelSpanAttributes({ completionStartTime: new Date() }), undefined);
  }

  /** Closed by the turn while streaming, with the ledger's estimate for the cut-off call. */
  closeEstimated(level: ObservationLevel, statusMessage: string, call: CallCost): void {
    this.endOnce("generation_close_failed", (obs) =>
      obs.updateOtelSpanAttributes({
        ...generationUsage(call),
        level,
        statusMessage,
        metadata: { usage_estimated: true, pricing_tier: call.tier },
      })
    );
  }

  finish(result: GenerationResult): void {
    this.endOnce("generation_finish_failed", (obs) => obs.updateOtelSpanAttributes(this.attributes(result)));
  }

  /** The call finished but the turn fails on it (refusal): ERROR, usage and cost kept. */
  fail(result: GenerationResult, statusMessage: string): void {
    this.endOnce("generation_fail_failed", (obs) =>
      obs.updateOtelSpanAttributes({ ...this.attributes(result), level: "ERROR", statusMessage })
    );
  }

  private attributes(r: GenerationResult) {
    return {
      output: { text: r.text, reasoning: r.reasoning, tool_calls: r.toolCalls },
      ...generationUsage(r.call),
      metadata: { finish_reason: r.finishReason, raw_finish_reason: r.rawFinishReason, pricing_tier: r.call.tier },
    };
  }
}

export class ToolObservation extends Child {
  constructor(
    obs: LangfuseObservation | null,
    onDone: (child: Child) => void,
    private readonly onError: () => void = () => {}
  ) {
    super(obs, onDone);
  }

  finish(result: ToolResult): void {
    this.endOnce("tool_finish_failed", (obs) =>
      obs.updateOtelSpanAttributes({ output: result.output, metadata: result.metadata })
    );
  }

  /** The tool's error went back to the model: ERROR. */
  fail(result: ToolResult, statusMessage: string): void {
    this.onError();
    this.endOnce("tool_fail_failed", (obs) =>
      obs.updateOtelSpanAttributes({ output: result.output, metadata: result.metadata, level: "ERROR", statusMessage })
    );
  }
}

export class TurnTrace {
  private readonly open = new Set<Child>();
  private ended = false;
  private llmCalls = 0;
  private toolCalls = 0;
  private toolErrors = 0;

  private constructor(
    private readonly root: LangfuseAgent | null,
    private readonly traceAttributes: Attributes,
    /** Null when tracing is off. */
    readonly traceId: string | null,
    private readonly nested = false
  ) {}

  /** A trace that records nothing. */
  static readonly disabled = new TurnTrace(null, {}, null);

  /** The turn's root observation id when it is nested in a larger trace (its scores go there); else null. */
  get scoreObservationId(): string | null {
    return this.nested && this.root ? this.root.id : null;
  }

  static start(p: TurnTraceStart): TurnTrace {
    if (!tracingActive()) return TurnTrace.disabled;
    return safely(
      "trace_start_failed",
      () => {
        const parent = p.traceParent;
        const traceId = parent?.traceId ?? traceIdForTurn(p.turnId);
        const traceAttributes: Attributes = {
          ...(parent ? {} : { [LangfuseOtelSpanAttributes.TRACE_NAME]: "chat-turn" }),
          [LangfuseOtelSpanAttributes.TRACE_SESSION_ID]: p.sessionId,
          [LangfuseOtelSpanAttributes.TRACE_USER_ID]: p.userId,
          [LangfuseOtelSpanAttributes.TRACE_TAGS]: [p.provider, p.model],
        };
        const root = startObservation(
          "chat-turn",
          {
            input: p.userMessage,
            metadata: { turn_id: p.turnId, session_id: p.sessionId, provider: p.provider, model: p.model, ...p.metadata },
          },
          {
            asType: "agent",
            parentSpanContext: { traceId, spanId: parent?.spanId ?? "0123456789abcdef", traceFlags: TraceFlags.SAMPLED, isRemote: true },
          }
        );
        root.otelSpan.setAttributes(traceAttributes);
        return new TurnTrace(root, traceAttributes, traceId, Boolean(parent));
      },
      TurnTrace.disabled
    );
  }

  get enabled(): boolean {
    return this.root !== null;
  }

  setMetadata(metadata: Record<string, unknown>): void {
    const root = this.root;
    if (!root || this.ended) return;
    safely("trace_metadata_failed", () => root.update({ metadata }), undefined);
  }

  generation(p: GenerationStart): GenerationObservation {
    this.llmCalls++;
    const obs = this.child("generation_start_failed", () =>
      this.root!.startObservation(
        "llm-call",
        {
          model: p.model,
          input: p.input,
          modelParameters: p.modelParameters,
          metadata: { iteration: p.iteration, ...p.metadata },
        },
        { asType: "generation" }
      )
    );
    return this.track(new GenerationObservation(obs, (c) => this.open.delete(c)), obs);
  }

  tool(p: ToolStart): ToolObservation {
    this.toolCalls++;
    const attrs = { input: p.input, metadata: p.metadata };
    const obs = this.child("tool_start_failed", () =>
      p.asType === "retriever"
        ? this.root!.startObservation(p.name, attrs, { asType: "retriever" })
        : this.root!.startObservation(p.name, attrs, { asType: "tool" })
    );
    const tool = new ToolObservation(obs, (c) => this.open.delete(c), () => this.toolErrors++);
    return this.track(tool, obs);
  }

  /** Ends the turn: closes still-open children, then the root. Idempotent. */
  end(outcome: TurnTraceEnd): void {
    if (this.ended) return;
    this.ended = true;
    const level: ObservationLevel =
      outcome.status === "ok" ? "DEFAULT" : outcome.status === "error" ? "ERROR" : "WARNING";
    const statusMessage = outcome.message ?? (outcome.status === "ok" ? undefined : outcome.status);
    const childLevel = level === "DEFAULT" ? "WARNING" : level;
    const childMessage = statusMessage ?? "turn ended before this observation finished";
    for (const child of [...this.open]) {
      if (child instanceof GenerationObservation && outcome.cutOffCall) {
        child.closeEstimated(childLevel, childMessage, outcome.cutOffCall);
      } else {
        child.close(childLevel, childMessage);
      }
    }
    const root = this.root;
    if (!root) return;
    if (outcome.tags?.length) {
      const tags = [...((this.traceAttributes[LangfuseOtelSpanAttributes.TRACE_TAGS] as string[] | undefined) ?? []), ...outcome.tags];
      safely("trace_end_failed", () => root.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_TAGS, tags), undefined);
    }
    safely(
      "trace_end_failed",
      () =>
        root.update({
          output: outcome.status === "ok" ? outcome.output : { error_code: outcome.errorCode ?? outcome.status, message: outcome.message },
          level,
          statusMessage,
          metadata: {
            status: outcome.status,
            error_code: outcome.errorCode,
            llm_calls: this.llmCalls,
            tool_calls_total: this.toolCalls,
            tool_calls_failed: this.toolErrors,
            ...outcome.metadata,
          },
        }),
      undefined
    );
    safely("trace_end_failed", () => root.end(), undefined);
  }

  private child(event: string, start: () => LangfuseObservation): LangfuseObservation | null {
    if (!this.root || this.ended) return null;
    return safely(
      event,
      () => {
        const obs = start();
        obs.otelSpan.setAttributes(this.traceAttributes);
        return obs;
      },
      null
    );
  }

  private track<T extends Child>(child: T, obs: LangfuseObservation | null): T {
    if (obs) this.open.add(child);
    return child;
  }
}
