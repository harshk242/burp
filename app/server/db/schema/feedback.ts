import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
    value: integer("value"),
    comment: text("comment"),
    categories: text("categories", { mode: "json" }).$type<FeedbackCategory[]>().notNull().default(sql`'[]'`),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
    revision: integer("revision").notNull().default(1),
    sync_pending: integer("sync_pending").notNull().default(1),
    synced_revision: integer("synced_revision"),
    synced_at: integer("synced_at"),
    sync_state: text("sync_state", { enum: ["pending", "accepted"] }).notNull().default("pending"),
    claim_token: text("claim_token"),
    claim_until: integer("claim_until").notNull().default(0),
    retry_at: integer("retry_at").notNull().default(0),
    failures: integer("failures").notNull().default(0),
  },
  (t) => [
    check("message_feedback_value_check", sql`value IN (0, 1)`),
    check("message_feedback_sync_pending_check", sql`sync_pending IN (0, 1)`),
    uniqueIndex("uq_message_feedback_message_user").on(t.message_id, t.user_id),
    index("idx_message_feedback_sync_pending").on(t.sync_pending),
  ],
);

export const feedbackSyncOperations = sqliteTable("feedback_sync_operations", {
  feedback_id: text("feedback_id").notNull().references(() => messageFeedback.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  state: text("state", { enum: ["write_pending", "accepted", "retired", "confirmation_pending", "cleaned"] }).notNull(),
  cleanup_at: integer("cleanup_at").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.feedback_id, t.revision] }),
  check("feedback_sync_operations_state_check", sql`state IN ('write_pending', 'accepted', 'retired', 'confirmation_pending', 'cleaned')`),
]);
