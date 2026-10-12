/**
 * chat_sessions, messages, chat_turns, model_transcript (rules in ./users.ts).
 */
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

/**
 * One row per user turn: created `running` when the turn starts, finalized when
 * it ends. Rows are kept for failed and aborted turns too (investigation); only
 * `ok` turns are meant for replay. Linked from usage_events.turn_id.
 */
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
    // NULL unless the turn succeeded.
    assistant_message_id: text("assistant_message_id").references(() => messages.id, { onDelete: "set null" }),
    status: text("status", { enum: ["running", "ok", "error", "aborted"] }).notNull().default("running"),
    // e.g. provider_error, max_tool_iterations, refusal, aborted (orchestration/chat-turn.ts).
    error_code: text("error_code"),
    error_message: text("error_message"),
    // LLM calls started (loop iterations).
    iterations: integer("iterations").notNull().default(0),
    // Measured prompt of the turn's last LLM call (ok turns): seeds the next
    // turn's context-budget estimate.
    last_prompt_tokens: integer("last_prompt_tokens"),
    // Langfuse trace of the turn; NULL when tracing was off.
    trace_id: text("trace_id"),
    started_at: integer("started_at").notNull().default(sql`(unixepoch())`),
    finished_at: integer("finished_at"),
  },
  (t) => [
    check("chat_turns_status_check", sql`status IN ('running', 'ok', 'error', 'aborted')`),
    index("idx_chat_turns_session_id").on(t.session_id, t.started_at),
  ],
);

/**
 * What the model saw, one row per `ModelMessage`, in send order (`seq`). Rows
 * are appended as each loop iteration finishes and never updated (an UPDATE
 * trigger enforces it): replay will `JSON.parse` them as they are, and any
 * change to a stored message breaks the prompt cache and thinking signatures.
 * Written for failed turns too; replay reads `ok` turns only.
 */
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
    // The ModelMessage exactly as sent (cache markers excluded).
    content_json: text("content_json").notNull(),
    // Compatibility tag: a later turn replays this row only if all three match.
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    context_version: text("context_version").notNull(),
    // Sorted tool names from the message's tool-call and tool-reference parts.
    tool_names_json: text("tool_names_json").notNull().default("[]"),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    check("model_transcript_role_check", sql`role IN ('user', 'assistant', 'tool', 'system')`),
    uniqueIndex("uq_model_transcript_session_seq").on(t.session_id, t.seq),
    index("idx_model_transcript_turn_id").on(t.turn_id),
  ],
);
