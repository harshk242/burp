/**
 * message_feedback: one row per (assistant message, user). Every write bumps
 * `revision` and sets `sync_pending`; observability/feedback-sync.ts clears it
 * with a compare-and-set on the revision it pushed. `delete_unconfirmed` is
 * sync bookkeeping only (see feedback-sync.ts).
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { DrizzleDb } from "../connection";
import { chatTurns, messageFeedback, messages } from "../schema";

export type DbMessageFeedback = typeof messageFeedback.$inferSelect;
export type FeedbackValue = 0 | 1;

export interface FeedbackKey {
  messageId: string;
  userId: string;
}

const pendingWrite = {
  revision: sql`${messageFeedback.revision} + 1`,
  sync_pending: 1,
  updated_at: sql`(unixepoch())`,
};

export function createMessageFeedbackQueries(db: DrizzleDb) {
  const byKey = ({ messageId, userId }: FeedbackKey) =>
    and(eq(messageFeedback.message_id, messageId), eq(messageFeedback.user_id, userId));

  return {
    /** Sets the value (re-creating a cleared row in place, so its id is kept). */
    upsert(key: FeedbackKey, value: FeedbackValue, comment: string | null): DbMessageFeedback {
      return db
        .insert(messageFeedback)
        .values({ id: uuidv4(), message_id: key.messageId, user_id: key.userId, value, comment })
        .onConflictDoUpdate({
          target: [messageFeedback.message_id, messageFeedback.user_id],
          set: { value, comment, ...pendingWrite },
        })
        .returning()
        .get();
    },

    /** Clears the value (tombstone). Null when the user never gave feedback on the message. */
    clear(key: FeedbackKey): DbMessageFeedback | null {
      return (
        db
          .update(messageFeedback)
          .set({ value: null, comment: null, ...pendingWrite })
          .where(byKey(key))
          .returning()
          .get() ?? null
      );
    },

    find(key: FeedbackKey): DbMessageFeedback | null {
      return db.select().from(messageFeedback).where(byKey(key)).get() ?? null;
    },

    findPending(): DbMessageFeedback[] {
      return db.select().from(messageFeedback).where(eq(messageFeedback.sync_pending, 1)).all();
    },

    /**
     * Records that Langfuse acknowledged `revision`. Clears sync_pending only if
     * no write happened since (revision unchanged). Returns whether it cleared.
     */
    markSynced(key: FeedbackKey, revision: number): boolean {
      const updated = db
        .update(messageFeedback)
        .set({
          synced_revision: revision,
          synced_at: sql`(unixepoch())`,
          sync_pending: sql`CASE WHEN ${messageFeedback.revision} = ${revision} THEN 0 ELSE 1 END`,
        })
        .where(byKey(key))
        .returning({ sync_pending: messageFeedback.sync_pending })
        .get();
      return updated?.sync_pending === 0;
    },

    /** Sets or clears delete_unconfirmed (a sent delete that may not have been applied yet). Not a write: revision is unchanged. */
    setDeleteUnconfirmed(key: FeedbackKey, unconfirmed: boolean): void {
      db.update(messageFeedback).set({ delete_unconfirmed: unconfirmed ? 1 : 0 }).where(byKey(key)).run();
    },

    /** The Langfuse trace of the turn that produced the assistant message (null when tracing was off). */
    traceIdForMessage(messageId: string): string | null {
      const row = db
        .select({ trace_id: chatTurns.trace_id })
        .from(chatTurns)
        .where(eq(chatTurns.assistant_message_id, messageId))
        .get();
      return row?.trace_id ?? null;
    },

    /** The user's current (non-cleared) feedback on a session's messages, by message id. */
    findForSession(sessionId: string, userId: string): Map<string, { value: FeedbackValue; comment: string | null }> {
      const rows = db
        .select({ message_id: messageFeedback.message_id, value: messageFeedback.value, comment: messageFeedback.comment })
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
      return new Map(rows.map((r) => [r.message_id, { value: r.value as FeedbackValue, comment: r.comment }]));
    },
  };
}
