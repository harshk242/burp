import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { FeedbackCategory } from "../../schemas/feedback-categories";
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
      return db.select().from(messageFeedback).where(eq(messageFeedback.sync_pending, 1)).all();
    },

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

    setDeleteUnconfirmed(key: FeedbackKey, unconfirmed: boolean): void {
      db.update(messageFeedback).set({ delete_unconfirmed: unconfirmed ? 1 : 0 }).where(byKey(key)).run();
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
