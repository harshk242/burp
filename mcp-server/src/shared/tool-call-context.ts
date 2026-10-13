// Per-tool-call context for the shared HTTP retry layer: the tool-call deadline
// signal, the caller's abort signal and the upstream request records that are
// aggregated into `_meta.retry` (see plans/shared-http-retry-plan.md, step 4).

import { AsyncLocalStorage } from 'node:async_hooks';

/** Default tool-call time when the client sends no `_meta.deadline_ms`. */
export const DEFAULT_TOOL_CALL_MS = 55_000;
/** Margin between the client's MCP timeout and the server's tool-call deadline. */
export const DEADLINE_MARGIN_MS = 5_000;
/** Request records kept per tool call in `RetryMeta.requests`. */
export const MAX_REQUEST_RECORDS = 20;

export type RequestOutcome = 'success' | 'failed' | 'cancelled';

export interface RequestRecord {
  platform: string;
  method: string;
  /** Path only: no query string or host. */
  path: string;
  attempts: number;
  ms: number;
  /** One per attempt; null = no response. */
  statuses: (number | null)[];
  outcome: RequestOutcome;
  /** Final failure reason; null on success. */
  reason: string | null;
}

export interface RetryMeta {
  platforms: string[];
  request_count: number;
  attempts: number;
  retried_requests: number;
  failed_requests: number;
  total_ms: number;
  outcome: 'success' | 'recovered' | 'partial' | 'failed' | 'cancelled';
  requests: RequestRecord[];
  requests_truncated: boolean;
}

export interface ToolCallContextOptions {
  /** Time allowed for the whole tool call. */
  timeoutMs: number;
  /** The MCP request's abort signal (`extra.signal`). */
  signal?: AbortSignal;
  now?: () => number;
}

/** A timer-backed abort signal that works with fake timers and can be cleared. */
export interface TimeoutSignal {
  signal: AbortSignal;
  clear: () => void;
}

export function createTimeoutSignal(ms: number, message = 'Deadline exceeded'): TimeoutSignal {
  const controller = new AbortController();
  const fire = () => controller.abort(new DOMException(message, 'TimeoutError'));
  if (ms <= 0) {
    fire();
    return { signal: controller.signal, clear: () => {} };
  }
  const timer = setTimeout(fire, ms);
  (timer as { unref?: () => void }).unref?.();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export class ToolCallContext {
  readonly deadlineSignal: AbortSignal;
  readonly callerSignal?: AbortSignal;
  readonly deadlineAt: number;
  private readonly now: () => number;
  private readonly clearDeadline: () => void;
  private readonly records: RequestRecord[] = [];
  private readonly platforms: string[] = [];
  private count = 0;
  private attempts = 0;
  private retried = 0;
  private failed = 0;
  private firstStart: number | null = null;
  private lastEnd: number | null = null;

  constructor({ timeoutMs, signal, now = Date.now }: ToolCallContextOptions) {
    this.now = now;
    this.deadlineAt = now() + timeoutMs;
    const deadline = createTimeoutSignal(timeoutMs, 'Tool call deadline exceeded');
    this.deadlineSignal = deadline.signal;
    this.clearDeadline = deadline.clear;
    this.callerSignal = signal;
  }

  remainingMs(): number {
    if (this.deadlineSignal.aborted) return 0;
    return Math.max(0, this.deadlineAt - this.now());
  }

  get cancelled(): boolean {
    return this.callerSignal?.aborted ?? false;
  }

  get requestCount(): number {
    return this.count;
  }

  /** Appends one logical request; only the first MAX_REQUEST_RECORDS are kept. */
  addRecord(record: RequestRecord, startedAt: number, endedAt: number): void {
    this.count += 1;
    this.attempts += record.attempts;
    if (record.attempts > 1) this.retried += 1;
    if (record.outcome !== 'success') this.failed += 1;
    if (!this.platforms.includes(record.platform)) this.platforms.push(record.platform);
    this.firstStart = this.firstStart === null ? startedAt : Math.min(this.firstStart, startedAt);
    this.lastEnd = this.lastEnd === null ? endedAt : Math.max(this.lastEnd, endedAt);
    if (this.records.length < MAX_REQUEST_RECORDS) this.records.push(record);
  }

  /** Aggregated `_meta.retry`, or undefined if the call made no upstream request. */
  buildRetryMeta({ isError }: { isError: boolean }): RetryMeta | undefined {
    if (this.count === 0) return undefined;
    let outcome: RetryMeta['outcome'];
    if (this.cancelled) outcome = 'cancelled';
    else if (isError) outcome = 'failed';
    else if (this.failed > 0) outcome = 'partial';
    else if (this.retried > 0) outcome = 'recovered';
    else outcome = 'success';
    return {
      platforms: [...this.platforms],
      request_count: this.count,
      attempts: this.attempts,
      retried_requests: this.retried,
      failed_requests: this.failed,
      total_ms: Math.max(0, (this.lastEnd ?? 0) - (this.firstStart ?? 0)),
      outcome,
      requests: this.records.map((r) => ({ ...r, statuses: [...r.statuses] })),
      requests_truncated: this.count > this.records.length,
    };
  }

  /** Stops the deadline timer. */
  dispose(): void {
    this.clearDeadline();
  }
}

const storage = new AsyncLocalStorage<ToolCallContext>();

/** The current tool call's context, or undefined outside a tool call (e.g. contract tests). */
export function getToolCallContext(): ToolCallContext | undefined {
  return storage.getStore();
}

/** Runs `fn` inside a fresh tool-call context and disposes it afterwards. */
export async function runWithToolCallContext<T>(
  options: ToolCallContextOptions,
  fn: (context: ToolCallContext) => Promise<T> | T,
): Promise<T> {
  const context = new ToolCallContext(options);
  try {
    return await storage.run(context, () => fn(context));
  } finally {
    context.dispose();
  }
}

/** Tool-call time from the client's `_meta.deadline_ms` (minus the margin), or the default. */
export function resolveToolCallTimeoutMs(deadlineMs: unknown): number {
  if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return DEFAULT_TOOL_CALL_MS;
  }
  // A client timeout within the margin leaves no time: requests fail as
  // `timeout` without being sent rather than outliving the client.
  return Math.max(0, deadlineMs - DEADLINE_MARGIN_MS);
}
