import { and, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { FeedbackCategory } from "../../schemas/feedback-categories";
import type { DrizzleDb } from "../connection";
import { chatTurns, feedbackSyncOperations, messageFeedback, messages } from "../schema";

export type DbMessageFeedback = typeof messageFeedback.$inferSelect;
export type FeedbackValue = 0 | 1;

export interface FeedbackKey {
  messageId: string;
  userId: string;
}

const pendingWrite = {
  revision: sql`${messageFeedback.revision} + 1`,
  sync_pending: 1,
  sync_state: "pending" as const,
  retry_at: 0,
  failures: 0,
  updated_at: sql`(unixepoch())`,
};

export function createMessageFeedbackQueries(db: DrizzleDb) {
  const byKey = ({ messageId, userId }: FeedbackKey) =>
    and(eq(messageFeedback.message_id, messageId), eq(messageFeedback.user_id, userId));

  return {
    upsert(key: FeedbackKey, value: FeedbackValue, comment: string | null, categories: FeedbackCategory[] = []): DbMessageFeedback {
      return db
        .insert(messageFeedback)
        .values({ id: uuidv4(), message_id: key.messageId, user_id: key.userId, value, comment, categories })
        .onConflictDoUpdate({
          target: [messageFeedback.message_id, messageFeedback.user_id],
          set: { value, comment, categories, ...pendingWrite },
        })
        .returning()
        .get();
    },

    clear(key: FeedbackKey): DbMessageFeedback | null {
      return (
        db
          .update(messageFeedback)
          .set({ value: null, comment: null, categories: [], ...pendingWrite })
          .where(byKey(key))
          .returning()
          .get() ?? null
      );
    },

    find(key: FeedbackKey): DbMessageFeedback | null {
      return db.select().from(messageFeedback).where(byKey(key)).get() ?? null;
    },

    findPending(): DbMessageFeedback[] {
      return db.select().from(messageFeedback).where(or(eq(messageFeedback.sync_pending, 1), sql`EXISTS (SELECT 1 FROM feedback_sync_operations WHERE feedback_id = ${messageFeedback.id} AND revision < ${messageFeedback.revision} AND state != 'cleaned')`)).all();
    },

    claim(key: FeedbackKey, token: string, now: number, leaseMs: number): DbMessageFeedback | null {
      return db.transaction(() => {
        const row = db.update(messageFeedback)
          .set({ claim_token: token, claim_until: now + leaseMs })
          .where(and(byKey(key), lte(messageFeedback.claim_until, now), lte(messageFeedback.retry_at, now)))
          .returning().get();
        if (!row) return null;
        if (row.sync_pending) db.insert(feedbackSyncOperations)
          .values({ feedback_id: row.id, revision: row.revision, state: "write_pending" })
          .onConflictDoNothing().run();
        return row;
      });
    },

    acknowledge(key: FeedbackKey, token: string, revision: number): boolean {
      return db.transaction(() => {
        const current = db.select().from(messageFeedback)
          .where(and(byKey(key), eq(messageFeedback.claim_token, token))).get();
        if (!current) return false;
        db.update(feedbackSyncOperations)
          .set({ state: current.revision === revision ? "accepted" : "retired" })
          .where(and(eq(feedbackSyncOperations.feedback_id, current.id), eq(feedbackSyncOperations.revision, revision))).run();
        db.update(messageFeedback).set({
          synced_revision: revision, synced_at: sql`(unixepoch())`,
          sync_pending: current.revision === revision ? 0 : 1,
          sync_state: current.revision === revision ? "accepted" : "pending",
        }).where(and(byKey(key), eq(messageFeedback.claim_token, token))).run();
        return current.revision === revision;
      });
    },

    cleanupDue(feedbackId: string, revision: number, now: number): number[] {
      return db.select({ revision: feedbackSyncOperations.revision }).from(feedbackSyncOperations)
        .where(and(eq(feedbackSyncOperations.feedback_id, feedbackId), lt(feedbackSyncOperations.revision, revision),
          sql`${feedbackSyncOperations.state} != 'cleaned'`, lte(feedbackSyncOperations.cleanup_at, now))).all().map((r) => r.revision);
    },

    advanceCleanup(feedbackId: string, revision: number, nextAt: number): void {
      db.update(feedbackSyncOperations).set({
        state: sql`CASE WHEN ${feedbackSyncOperations.state} = 'confirmation_pending' THEN 'cleaned' ELSE 'confirmation_pending' END`,
        cleanup_at: nextAt,
      })
        .where(and(eq(feedbackSyncOperations.feedback_id, feedbackId), eq(feedbackSyncOperations.revision, revision),
          sql`${feedbackSyncOperations.state} != 'cleaned'`)).run();
    },

    release(key: FeedbackKey, token: string, revision: number, retryAt = 0, failures = 0): void {
      db.update(messageFeedback).set({
        claim_token: null, claim_until: 0,
        retry_at: sql`CASE WHEN ${messageFeedback.revision} = ${revision} THEN ${retryAt} ELSE ${messageFeedback.retry_at} END`,
        failures: sql`CASE WHEN ${messageFeedback.revision} = ${revision} THEN ${failures} ELSE ${messageFeedback.failures} END`,
      })
        .where(and(byKey(key), eq(messageFeedback.claim_token, token))).run();
    },

    traceIdForMessage(messageId: string): string | null {
      const row = db
        .select({ trace_id: chatTurns.trace_id })
        .from(chatTurns)
        .where(eq(chatTurns.assistant_message_id, messageId))
        .get();
      return row?.trace_id ?? null;
    },

    findForSession(
      sessionId: string,
      userId: string
    ): Map<string, { value: FeedbackValue; comment: string | null; categories: FeedbackCategory[] }> {
      const rows = db
        .select({
          message_id: messageFeedback.message_id,
          value: messageFeedback.value,
          comment: messageFeedback.comment,
          categories: messageFeedback.categories,
        })
        .from(messageFeedback)
        .where(
          and(
            eq(messageFeedback.user_id, userId),
            isNotNull(messageFeedback.value),
            inArray(
              messageFeedback.message_id,
              db.select({ id: messages.id }).from(messages).where(eq(messages.chat_id, sessionId))
            )
          )
        )
        .all();
      return new Map(
        rows.map((r) => [r.message_id, { value: r.value as FeedbackValue, comment: r.comment, categories: r.categories }])
      );
    },
  };
}
