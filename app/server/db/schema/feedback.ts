/**
 * message_feedback (rules in ./users.ts): a user's 👍/👎 on an assistant
 * message. The row is the source of truth; observability/feedback-sync.ts
 * mirrors it to Langfuse as a `user_feedback` score plus `feedback_<category>` scores.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FeedbackCategory } from "../../schemas/feedback-categories";
import { messages } from "./chat";
import { users } from "./users";

export const messageFeedback = sqliteTable(
  "message_feedback",
  {
    id: text("id").primaryKey(),
    message_id: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 1 = 👍, 0 = 👎, NULL = cleared (tombstone: the row stays so the score gets deleted).
    value: integer("value"),
    comment: text("comment"),
    // Selected category ids (schemas/feedback-categories.ts), deduped and sorted; [] when none or cleared.
    categories: text("categories", { mode: "json" }).$type<FeedbackCategory[]>().notNull().default(sql`'[]'`),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
    // Incremented on every write; sync clears sync_pending only if it still matches the pushed revision.
    revision: integer("revision").notNull().default(1),
    sync_pending: integer("sync_pending").notNull().default(1),
    // Last revision Langfuse acknowledged (NULL = never synced).
    synced_revision: integer("synced_revision"),
    synced_at: integer("synced_at"),
    // 1 = a delete was sent and not yet confirmed applied. Langfuse queues deletes and may apply
    // one after a later upsert, so until this clears every upsert is read back before it counts.
    delete_unconfirmed: integer("delete_unconfirmed").notNull().default(0),
  },
  (t) => [
    check("message_feedback_value_check", sql`value IN (0, 1)`),
    check("message_feedback_sync_pending_check", sql`sync_pending IN (0, 1)`),
    uniqueIndex("uq_message_feedback_message_user").on(t.message_id, t.user_id),
    index("idx_message_feedback_sync_pending").on(t.sync_pending),
  ],
);
