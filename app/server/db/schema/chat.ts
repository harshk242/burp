import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
    tool_calls: text("tool_calls"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    reasoning: text("reasoning"),
    cost_microusd: integer("cost_microusd").notNull().default(0),
  },
  (t) => [
    check("messages_role_check", sql`role IN ('user', 'assistant')`),
    index("idx_messages_chat_id").on(t.chat_id),
  ],
);

export const chatTurns = sqliteTable(
  "chat_turns",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    user_message_id: text("user_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    assistant_message_id: text("assistant_message_id").references(() => messages.id, { onDelete: "set null" }),
    status: text("status", { enum: ["running", "ok", "error", "aborted"] }).notNull().default("running"),
    error_code: text("error_code"),
    error_message: text("error_message"),
    iterations: integer("iterations").notNull().default(0),
    last_prompt_tokens: integer("last_prompt_tokens"),
    last_input_message_count: integer("last_input_message_count"),
    last_input_identity: text("last_input_identity"),
    trace_id: text("trace_id"),
    final_finish_reason: text("final_finish_reason"),
    tool_error_count: integer("tool_error_count").notNull().default(0),
    started_at: integer("started_at").notNull().default(sql`(unixepoch())`),
    finished_at: integer("finished_at"),
  },
  (t) => [
    check("chat_turns_status_check", sql`status IN ('running', 'ok', 'error', 'aborted')`),
    index("idx_chat_turns_session_id").on(t.session_id, t.started_at),
  ],
);

export const modelTranscript = sqliteTable(
  "model_transcript",
  {
    id: integer("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    turn_id: text("turn_id")
      .notNull()
      .references(() => chatTurns.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "tool", "system"] }).notNull(),
    content_json: text("content_json").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    context_version: text("context_version").notNull(),
    tool_names_json: text("tool_names_json").notNull().default("[]"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    check("model_transcript_role_check", sql`role IN ('user', 'assistant', 'tool', 'system')`),
    uniqueIndex("uq_model_transcript_session_seq").on(t.session_id, t.seq),
    index("idx_model_transcript_turn_id").on(t.turn_id),
  ],
);
