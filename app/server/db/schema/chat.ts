/**
 * chat_sessions + messages (rules in ./users.ts).
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const chatSessions = sqliteTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    updated_at: integer("updated_at"),
  },
  (t) => [index("idx_chat_sessions_user_id").on(t.user_id)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    chat_id: text("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content"),
    tool_calls: text("tool_calls"), // JSON array of tool calls
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    // Token counts per assistant message (0 for user messages and pre-migration rows)
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    // Reasoning text (pre-tool-call text) stored separately to avoid model context contamination
    reasoning: text("reasoning"),
    // Dollar cost charged for this assistant turn (main chat model only)
    cost_microusd: integer("cost_microusd").notNull().default(0),
  },
  (t) => [
    check("messages_role_check", sql`role IN ('user', 'assistant')`),
    index("idx_messages_chat_id").on(t.chat_id),
  ],
);
