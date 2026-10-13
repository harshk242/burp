/**
 * Feedback sync: mirrors message_feedback rows (the source of truth) to
 * Langfuse as `user_feedback` scores on the turn's trace.
 *
 * - One score per (message, user): id `fb-` + sha256(`message_id:user_id`), so
 *   clear → re-create overwrites instead of adding a second score.
 * - Pushes are serialized per score id (an in-process keyed queue shared by
 *   request-triggered syncs and reconciliation; assumes one app process). Each
 *   push reads the current row, makes one acknowledged write (ScoreWriter) and
 *   clears sync_pending only via compare-and-set on the pushed revision, so a
 *   click during the push leaves the row pending for the push queued behind it.
 * - Tombstones (value NULL) delete the score, then confirm it is gone: Langfuse
 *   does not order a create and a delete for one id (a delete sent before the
 *   create was ingested is lost and the score reappears ~10–30 s later), so the
 *   confirm read waits out the ingestion lag and deletes again if needed.
 * - The reverse also holds: a delete is only queued when acknowledged, so it can
 *   land after a later upsert. `delete_unconfirmed` is set before every delete
 *   and cleared only once a read-back confirms the latest state; while it is
 *   set, an upsert counts only if the score is still present through the
 *   confirm deadline, and is re-sent (row stays pending) if a read misses it.
 * - Rows whose turn has no trace (tracing was off) are marked synced without a
 *   remote write.
 * - Reconciliation retries pending rows on boot and every 5 min, with backoff
 *   per score id. Nothing here throws to callers.
 */

import { createHash } from "node:crypto";
import type { DbMessageFeedback, FeedbackKey } from "../db/queries";
import { logger } from "../logger";
import type { ScoreUpsert, ScoreWriter } from "./score-writer";
import { scoreConfigId } from "./score-configs";

export const FEEDBACK_SCORE_NAME = "user_feedback";

/** The queries the sync needs (db/queries/message-feedback.ts). */
export interface FeedbackSyncQueries {
  find(key: FeedbackKey): DbMessageFeedback | null;
  findPending(): DbMessageFeedback[];
  markSynced(key: FeedbackKey, revision: number): boolean;
  setDeleteUnconfirmed(key: FeedbackKey, unconfirmed: boolean): void;
  traceIdForMessage(messageId: string): string | null;
}

export interface FeedbackSyncOptions {
  queries: FeedbackSyncQueries;
  writer: ScoreWriter;
  environment: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Confirm reads: first read `settleMs` after the write, then every `pollMs` until `deadlineMs`. */
  confirm?: { settleMs: number; pollMs: number; deadlineMs: number };
  /** Reconciliation backoff per score id after a failed push. */
  backoff?: { baseMs: number; maxMs: number };
}

export type PushResult = "synced" | "pending" | "failed";

/** Stable score id for a user's feedback on a message. */
export function feedbackScoreId({ messageId, userId }: FeedbackKey): string {
  return `fb-${createHash("sha256").update(`${messageId}:${userId}`).digest("hex").slice(0, 32)}`;
}

const DEFAULT_CONFIRM = { settleMs: 60_000, pollMs: 15_000, deadlineMs: 120_000 };
const DEFAULT_BACKOFF = { baseMs: 60_000, maxMs: 60 * 60_000 };
const SUPERSEDE_CHECK_MS = 5_000;
const RECONCILE_CONCURRENCY = 4;

export function createFeedbackSync(options: FeedbackSyncOptions) {
  const { queries, writer, environment } = options;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const now = options.now ?? Date.now;
  const confirm = options.confirm ?? DEFAULT_CONFIRM;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;

  // Per score id: the tail of its push chain, and whether a push is queued but not started.
  const tails = new Map<string, Promise<PushResult>>();
  const queued = new Set<string>();
  const failures = new Map<string, { count: number; nextAt: number }>();
  let reconciling: Promise<void> | null = null;

  /** Waits `ms` in steps; true as soon as a newer write superseded the pushed revision. */
  async function waitUnlessSuperseded(ms: number, superseded: () => boolean): Promise<boolean> {
    for (let left = ms; left > 0; left -= SUPERSEDE_CHECK_MS) {
      await sleep(Math.min(left, SUPERSEDE_CHECK_MS));
      if (superseded()) return true;
    }
    return superseded();
  }

  /** Reads the score back after the ingestion lag: "absent" at the first read that misses it, "present" if every read up to the deadline sees it. */
  async function readBack(scoreId: string, superseded: () => boolean): Promise<"absent" | "present" | "superseded"> {
    if (await waitUnlessSuperseded(confirm.settleMs, superseded)) return "superseded";
    for (let waited = confirm.settleMs; ; waited += confirm.pollMs) {
      if (!(await writer.exists(scoreId))) return "absent";
      if (waited >= confirm.deadlineMs) return "present";
      if (await waitUnlessSuperseded(confirm.pollMs, superseded)) return "superseded";
    }
  }

  async function pushOnce(key: FeedbackKey, scoreId: string): Promise<PushResult> {
    const row = queries.find(key);
    if (!row || row.sync_pending === 0) return "synced";
    const { revision } = row;
    const traceId = queries.traceIdForMessage(key.messageId);
    const synced = (): PushResult => (queries.markSynced(key, revision) ? "synced" : "pending");
    if (!traceId) return synced();
    const superseded = () => queries.find(key)?.revision !== revision;
    // The latest remote state is confirmed, so no earlier delete can still land.
    const confirmed = (): PushResult => {
      queries.setDeleteUnconfirmed(key, false);
      return synced();
    };

    if (row.value !== null) {
      const score: ScoreUpsert = {
        id: scoreId,
        traceId,
        name: FEEDBACK_SCORE_NAME,
        value: row.value,
        dataType: "NUMERIC",
        environment,
        comment: row.comment,
        configId: scoreConfigId(FEEDBACK_SCORE_NAME),
        metadata: { message_id: key.messageId },
      };
      await writer.upsert(score);
      if (row.delete_unconfirmed === 0) return synced();
      const outcome = await readBack(scoreId, superseded);
      if (outcome === "present") return confirmed();
      if (outcome === "superseded") return "pending";
      // A queued delete landed after the upsert: send it again, confirm on a later push.
      await writer.upsert(score);
      logger.warn("TRACE", "feedback_score_deleted_late", { data: { score_id: scoreId, revision } });
      return "failed";
    }

    queries.setDeleteUnconfirmed(key, true);
    await writer.remove(scoreId);
    const outcome = await readBack(scoreId, superseded);
    if (outcome === "absent") return confirmed();
    if (outcome === "superseded") return "pending";
    // An acknowledged upsert was ingested after the delete: delete again, confirm on a later push.
    await writer.remove(scoreId);
    logger.warn("TRACE", "feedback_tombstone_still_present", { data: { score_id: scoreId, revision } });
    return "failed";
  }

  async function attempt(key: FeedbackKey, scoreId: string): Promise<PushResult> {
    let result: PushResult;
    try {
      result = await pushOnce(key, scoreId);
    } catch (error) {
      logger.warn("TRACE", "feedback_sync_failed", {
        data: { score_id: scoreId, message_id: key.messageId },
        error: error instanceof Error ? error : String(error),
      });
      result = "failed";
    }
    if (result === "failed") {
      const count = (failures.get(scoreId)?.count ?? 0) + 1;
      failures.set(scoreId, { count, nextAt: now() + Math.min(backoff.baseMs * 2 ** (count - 1), backoff.maxMs) });
    } else {
      failures.delete(scoreId);
    }
    return result;
  }

  /**
   * Queues a push for the key behind any push already running for its score
   * id. A push already waiting to start covers this request (it reads the
   * latest row when it starts). Never rejects.
   */
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

  /** Retries every pending row that is due (backoff). A pass already running is joined. */
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
      .filter((key) => (failures.get(feedbackScoreId(key))?.nextAt ?? 0) <= now());
    if (due.length === 0) return;
    logger.info("TRACE", "feedback_reconcile", { data: { pending: rows.length, due: due.length } });
    let next = 0;
    const worker = async () => {
      while (next < due.length) await sync(due[next++]!);
    };
    await Promise.all(Array.from({ length: Math.min(RECONCILE_CONCURRENCY, due.length) }, worker));
  }

  /** Resolves once every push queued so far has finished (tests, shutdown). */
  async function idle(): Promise<void> {
    while (tails.size > 0) await Promise.all([...tails.values()]);
  }

  return { sync, reconcile, idle };
}

export type FeedbackSync = ReturnType<typeof createFeedbackSync>;

// ── App instance ───────────────────────────────────────────────────────────

export const RECONCILE_INTERVAL_MS = 5 * 60_000;

let active: FeedbackSync | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the app's feedback sync: a reconcile pass now and every 5 min. Call only while tracing is on. */
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

/** Hands a written row to the sync (no-op when tracing is off: reconciliation picks it up later). */
export function requestFeedbackSync(key: FeedbackKey): void {
  void active?.sync(key);
}

/** Tests only: install a sync without the reconcile timer. */
export function setFeedbackSyncForTests(sync: FeedbackSync | null): void {
  stopFeedbackSync();
  active = sync;
}
