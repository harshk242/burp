import { APICallError, RetryError } from "ai";
import { logger, startTimer } from "../logger";
import { logIndexRejected, type IndexReadResult } from "./index-file";
import { syncToolEmbeddings, type SyncTool } from "./sync-index";
import { EmbeddingResponseError, EmbeddingTimeoutError, type Embedder } from "./types";

export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;
const RETRY_JITTER = 0.2;

/** Schedules `fn` after `ms`; returns a cancel function. */
export type Scheduler = (fn: () => void, ms: number) => () => void;

const defaultScheduler: Scheduler = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export interface EmbeddingSyncOptions {
  embedder: Embedder;
  path: string;
  /** Deadline for the embedding call of one attempt. */
  timeoutMs: number;
  /** Receives the vectors to attach for the synced snapshot. */
  onReady(embedder: Embedder, vectors: Map<string, Float32Array>): void;
  /** Delays before attempts 2, 3, 4. */
  retryDelaysMs?: readonly number[];
  scheduler?: Scheduler;
  /** Jitter source in [0, 1); tests pin it. */
  random?: () => number;
}

interface Job {
  tools: readonly SyncTool[];
  attempt: number;
}

/**
 * True for failures worth another attempt later: timeouts and API calls the
 * SDK marks retryable (network errors, 408/409/429/5xx). Everything else —
 * 4xx auth/config errors, invalid responses, missing keys, bugs — is not.
 */
export function isRetryableSyncError(error: unknown): boolean {
  if (RetryError.isInstance(error)) {
    return isRetryableSyncError(error.lastError);
  }
  if (APICallError.isInstance(error)) return error.isRetryable;
  if (error instanceof EmbeddingResponseError) return false;
  if (error instanceof EmbeddingTimeoutError) return true;
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export class ToolEmbeddingSync {
  private pending: Job | null = null;
  private running: Promise<void> | null = null;
  private cancelRetry: (() => void) | null = null;
  private stopped = false;
  private warnedRejection: string | null = null;
  private readonly retryDelaysMs: readonly number[];
  private readonly scheduler: Scheduler;
  private readonly random: () => number;

  constructor(private readonly options: EmbeddingSyncOptions) {
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.random = options.random ?? Math.random;
  }

  /** Sync the index to `tools` in the background. Never throws. */
  request(tools: readonly SyncTool[]): void {
    if (this.stopped) return;
    this.clearRetry();
    this.enqueue({ tools, attempt: 1 });
  }

  /** Resolves once no sync is running (a scheduled retry may still be pending). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  get retryScheduled(): boolean {
    return this.cancelRetry !== null;
  }

  /** Cancel any scheduled retry and ignore later requests. A running sync finishes. */
  stop(): void {
    this.stopped = true;
    this.pending = null;
    this.clearRetry();
  }

  private enqueue(job: Job): void {
    this.pending = job;
    if (!this.running) this.running = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        await this.run(job);
      }
    } finally {
      this.running = null;
    }
  }

  private async run(job: Job): Promise<void> {
    const { embedder, path, timeoutMs, onReady } = this.options;
    const elapsed = startTimer();
    try {
      const stats = await syncToolEmbeddings({
        embedder,
        tools: job.tools,
        path,
        timeoutMs,
        onReady: (vectors) => onReady(embedder, vectors),
        onIndexRejected: (rejection) => this.warnRejected(rejection),
      });
      if (stats.index === "valid" || stats.wrote) this.warnedRejection = null;
      logger.info("SEARCH", "embeddings_sync_complete", {
        duration_ms: elapsed(),
        data: {
          embedder: embedder.id,
          index: stats.index,
          kept: stats.kept,
          embedded: stats.embedded,
          pruned: stats.pruned,
          carried_over: stats.carriedOver,
          wrote: stats.wrote,
          attempt: job.attempt,
          path,
        },
      });
    } catch (error) {
      const retryable = isRetryableSyncError(error);
      const delay = retryable && !this.pending && !this.stopped ? this.retryDelaysMs[job.attempt - 1] : undefined;
      const nextRetryMs = delay === undefined ? undefined : this.jitter(delay);
      logger.error("SEARCH", "embeddings_sync_failed", {
        duration_ms: elapsed(),
        data: {
          embedder: embedder.id,
          attempt: job.attempt,
          retryable,
          next_retry_ms: nextRetryMs,
          retries_exhausted: retryable && job.attempt > this.retryDelaysMs.length,
          superseded: this.pending !== null,
        },
        error: error instanceof Error ? error : String(error),
      });
      if (nextRetryMs !== undefined) this.scheduleRetry({ tools: job.tools, attempt: job.attempt + 1 }, nextRetryMs);
    }
  }

  private warnRejected(rejection: Extract<IndexReadResult, { ok: false }>): void {
    const key = JSON.stringify([rejection.reason, rejection.detail]);
    if (key === this.warnedRejection) return;
    this.warnedRejection = key;
    logIndexRejected(this.options.path, rejection);
  }

  private scheduleRetry(job: Job, ms: number): void {
    this.cancelRetry = this.scheduler(() => {
      this.cancelRetry = null;
      if (!this.stopped) this.enqueue(job);
    }, ms);
  }

  private clearRetry(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  private jitter(ms: number): number {
    return Math.round(ms * (1 + (this.random() * 2 - 1) * RETRY_JITTER));
  }
}
