import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { chatSessions, chatTurns, messages } from "./chat";
import { users } from "./users";

export const dailyUsage = sqliteTable(
  "daily_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    query_count: integer("query_count").notNull().default(0),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
  },
  (t) => [
    unique().on(t.user_id, t.date),
    index("idx_daily_usage_user_date").on(t.user_id, t.date),
  ],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    role: text("role", { enum: ["user", "admin"] }).primaryKey(),
    daily_limit: integer("daily_limit").notNull(),
    updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    check("rate_limits_role_check", sql`role IN ('user', 'admin')`),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    month: text("month").notNull(),
    operation: text("operation", { enum: ["chat"] }).notNull().default("chat"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    cache_read_tokens: integer("cache_read_tokens").notNull().default(0),
    cache_write_5m_tokens: integer("cache_write_5m_tokens").notNull().default(0),
    cache_write_1h_tokens: integer("cache_write_1h_tokens").notNull().default(0),
    input_cost_per_mtok_microusd: integer("input_cost_per_mtok_microusd").notNull(),
    output_cost_per_mtok_microusd: integer("output_cost_per_mtok_microusd").notNull(),
    pricing_json: text("pricing_json"),
    cost_microusd: integer("cost_microusd").notNull().default(0),
    input_cost_microusd: integer("input_cost_microusd").notNull().default(0),
    cache_read_cost_microusd: integer("cache_read_cost_microusd").notNull().default(0),
    cache_write_cost_microusd: integer("cache_write_cost_microusd").notNull().default(0),
    output_cost_microusd: integer("output_cost_microusd").notNull().default(0),
    llm_calls: integer("llm_calls"),
    long_context_calls: integer("long_context_calls").notNull().default(0),
    status: text("status", { enum: ["ok", "error"] }).notNull().default("ok"),
    usage_estimated: integer("usage_estimated").notNull().default(0),
    session_id: text("session_id").references(() => chatSessions.id, { onDelete: "set null" }),
    message_id: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    turn_id: text("turn_id").references(() => chatTurns.id, { onDelete: "set null" }),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    check("usage_events_operation_check", sql`operation = 'chat'`),
    check("usage_events_status_check", sql`status IN ('ok', 'error')`),
    check("usage_events_usage_estimated_check", sql`usage_estimated IN (0, 1)`),
    index("idx_usage_events_user_date").on(t.user_id, t.date),
    index("idx_usage_events_user_month").on(t.user_id, t.month),
    index("idx_usage_events_message_id").on(t.message_id),
    index("idx_usage_events_turn_id").on(t.turn_id),
  ],
);
