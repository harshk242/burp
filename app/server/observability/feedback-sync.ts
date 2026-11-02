import { createHash, randomUUID } from "node:crypto";
import type { DbMessageFeedback, FeedbackKey } from "../db/queries";
import { logger } from "../logger";
import type { ScoreWriter } from "./score-writer";
import { categoryScoreUpserts, writeCategoryScores } from "./feedback-category-scores";
import { scoreConfigId } from "./score-configs";

export const FEEDBACK_SCORE_NAME = "user_feedback";

export interface FeedbackSyncQueries {
  find(key: FeedbackKey): DbMessageFeedback | null;
  findPending(): DbMessageFeedback[];
  claim(key: FeedbackKey, token: string, now: number, leaseMs: number): DbMessageFeedback | null;
  acknowledge(key: FeedbackKey, token: string, revision: number): boolean;
  cleanupDue(feedbackId: string, revision: number, now: number): number[];
  advanceCleanup(feedbackId: string, revision: number, nextAt: number): void;
  release(key: FeedbackKey, token: string, revision: number, retryAt?: number, failures?: number): void;
  traceIdForMessage(messageId: string): string | null;
}

export interface FeedbackSyncOptions {
  queries: FeedbackSyncQueries;
  writer: ScoreWriter;
  environment: string;
  now?: () => number;
  backoff?: { baseMs: number; maxMs: number };
}

export type PushResult = "synced" | "pending" | "failed";

export function feedbackScoreId({ messageId, userId }: FeedbackKey, revision = 0): string {
  const base = `fb-${createHash("sha256").update(`${messageId}:${userId}`).digest("hex").slice(0, 32)}`;
  return revision === 0 ? base : `${base}-r${revision}`;
}

const DEFAULT_BACKOFF = { baseMs: 60_000, maxMs: 60 * 60_000 };
const CLAIM_LEASE_MS = 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const RECONCILE_CONCURRENCY = 4;

export function createFeedbackSync(options: FeedbackSyncOptions) {
  const { queries, writer, environment } = options;
  const now = options.now ?? Date.now;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const tails = new Map<string, Promise<PushResult>>();
  const queued = new Set<string>();
  let reconciling: Promise<void> | null = null;

  async function attempt(key: FeedbackKey, scoreId: string): Promise<PushResult> {
    const token = randomUUID();
    let row: DbMessageFeedback | null = null;
    let retryAt = 0;
    let failures = 0;
    try {
      row = queries.claim(key, token, now(), CLAIM_LEASE_MS);
      if (!row) return queries.find(key)?.sync_pending === 0 ? "synced" : "pending";
      const { revision } = row;
      const traceId = queries.traceIdForMessage(key.messageId);
      let result: PushResult = "synced";
      if (row.sync_pending) {
        if (traceId) {
          if (row.value !== null) await writer.upsert({
            id: feedbackScoreId(key, revision), traceId, name: FEEDBACK_SCORE_NAME,
            value: row.value, dataType: "NUMERIC", environment, comment: row.comment,
            configId: scoreConfigId(FEEDBACK_SCORE_NAME),
            metadata: { message_id: key.messageId, feedback_revision: revision, categories: row.categories },
          });
          const categories = categoryScoreUpserts(key, traceId, row.value === null ? [] : row.categories, environment, revision);
          if (!(await writeCategoryScores(writer, categories))) throw new Error("Category writes failed");
        }
        result = queries.acknowledge(key, token, revision) ? "synced" : "pending";
      }
      for (const retired of queries.cleanupDue(row.id, revision, now())) {
        const ids = [feedbackScoreId(key, retired), ...categoryScoreUpserts(key, traceId ?? "", [], environment, retired).map((s) => s.id)];
        const results = await Promise.allSettled(traceId ? ids.map((id) => writer.remove(id)) : []);
        for (const [index, outcome] of results.entries()) if (outcome.status === "rejected") {
          logger.warn("TRACE", "feedback_cleanup_failed", {
            data: { score_id: ids[index], revision: retired },
            error: outcome.reason instanceof Error ? outcome.reason : String(outcome.reason),
          });
        }
        if (results.some((r) => r.status === "rejected")) throw new Error("Generation cleanup failed");
        queries.advanceCleanup(row.id, retired, now() + CLEANUP_INTERVAL_MS);
      }
      return result;
    } catch (error) {
      logger.warn("TRACE", "feedback_sync_failed", {
        data: { score_id: scoreId, message_id: key.messageId },
        error: error instanceof Error ? error : String(error),
      });
      if (row && queries.find(key)?.revision === row.revision) {
        failures = row.failures + 1;
        retryAt = now() + Math.min(backoff.baseMs * 2 ** (failures - 1), backoff.maxMs);
      }
      return "failed";
    } finally {
      if (row) try { queries.release(key, token, row.revision, retryAt, failures); } catch (error) {
        logger.warn("TRACE", "feedback_claim_release_failed", {
          data: { score_id: scoreId }, error: error instanceof Error ? error : String(error),
        });
      }
    }
  }

  function sync(key: FeedbackKey): Promise<PushResult> {
    const scoreId = feedbackScoreId(key);
    const tail = tails.get(scoreId);
    if (tail && queued.has(scoreId)) return tail;
    queued.add(scoreId);
    const next = (tail ?? Promise.resolve<PushResult>("synced")).then(() => {
      queued.delete(scoreId);
      return attempt(key, scoreId);
    });
    tails.set(scoreId, next);
    void next.then(() => {
      if (tails.get(scoreId) === next) tails.delete(scoreId);
    });
    return next;
  }

  function reconcile(): Promise<void> {
    reconciling ??= runReconcile().finally(() => {
      reconciling = null;
    });
    return reconciling;
  }

  async function runReconcile(): Promise<void> {
    let rows: DbMessageFeedback[];
    try {
      rows = queries.findPending();
    } catch (error) {
      logger.warn("TRACE", "feedback_reconcile_failed", { error: error instanceof Error ? error : String(error) });
      return;
    }
    const due = rows
      .map((row) => ({ messageId: row.message_id, userId: row.user_id }))
      .filter((key) => (queries.find(key)?.retry_at ?? 0) <= now());
    if (due.length === 0) return;
    logger.info("TRACE", "feedback_reconcile", { data: { pending: rows.length, due: due.length } });
    let next = 0;
    const worker = async () => {
      while (next < due.length) await sync(due[next++]!);
    };
    await Promise.all(Array.from({ length: Math.min(RECONCILE_CONCURRENCY, due.length) }, worker));
  }

  async function idle(): Promise<void> {
    while (tails.size > 0) await Promise.all([...tails.values()]);
  }

  return { sync, reconcile, idle };
}

export type FeedbackSync = ReturnType<typeof createFeedbackSync>;

export const RECONCILE_INTERVAL_MS = 5 * 60_000;

let active: FeedbackSync | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function startFeedbackSync(options: FeedbackSyncOptions): FeedbackSync {
  stopFeedbackSync();
  const sync = createFeedbackSync(options);
  active = sync;
  void sync.reconcile();
  timer = setInterval(() => void sync.reconcile(), RECONCILE_INTERVAL_MS);
  timer.unref?.();
  return sync;
}

export function stopFeedbackSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  active = null;
}

export function requestFeedbackSync(key: FeedbackKey): void {
  void active?.sync(key);
}

export function setFeedbackSyncForTests(sync: FeedbackSync | null): void {
  stopFeedbackSync();
  active = sync;
}
