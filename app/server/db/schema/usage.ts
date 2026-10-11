/**
 * daily_usage, rate_limits, usage_events (rules in ./users.ts).
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { chatSessions, chatTurns, messages } from "./chat";
import { users } from "./users";

/** One row per user per day. */
export const dailyUsage = sqliteTable(
  "daily_usage",
  {
    // INTEGER rowid alias: never NULL, so the emitted NOT NULL is semantically identical to legacy.
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD (UTC)
    query_count: integer("query_count").notNull().default(0),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    // Token aggregates for today (best-effort: incremented post-response)
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
  },
  (t) => [
    // Required by the ON CONFLICT(user_id, date) upsert.
    unique().on(t.user_id, t.date),
    index("idx_daily_usage_user_date").on(t.user_id, t.date),
  ],
);

/** Configurable rate limits per role. Seeded by 0002_seed_and_data_fixes. */
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

/** Per-query usage ledger for main chat model billing. */
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD (UTC)
    month: text("month").notNull(), // YYYY-MM (UTC)
    operation: text("operation", { enum: ["chat"] }).notNull().default("chat"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    // Total input, every category; uncached = input - the cache columns.
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    cache_read_tokens: integer("cache_read_tokens").notNull().default(0),
    cache_write_5m_tokens: integer("cache_write_5m_tokens").notNull().default(0),
    cache_write_1h_tokens: integer("cache_write_1h_tokens").notNull().default(0),
    // Base-tier rates; the full entry used (long-context tier included) is in pricing_json.
    input_cost_per_mtok_microusd: integer("input_cost_per_mtok_microusd").notNull(),
    output_cost_per_mtok_microusd: integer("output_cost_per_mtok_microusd").notNull(),
    pricing_json: text("pricing_json"),
    // Total that budgets read. The category costs are floored and the total is
    // rounded up once, so they can add up to a few µUSD less.
    cost_microusd: integer("cost_microusd").notNull().default(0),
    input_cost_microusd: integer("input_cost_microusd").notNull().default(0),
    cache_read_cost_microusd: integer("cache_read_cost_microusd").notNull().default(0),
    cache_write_cost_microusd: integer("cache_write_cost_microusd").notNull().default(0),
    output_cost_microusd: integer("output_cost_microusd").notNull().default(0),
    // NULL on legacy rows: not recorded.
    llm_calls: integer("llm_calls"),
    long_context_calls: integer("long_context_calls").notNull().default(0),
    // "error": a failed or aborted turn, billed for the calls that already ran.
    status: text("status", { enum: ["ok", "error"] }).notNull().default("ok"),
    // 1 when the row includes an estimate for a call cut off mid-stream.
    usage_estimated: integer("usage_estimated").notNull().default(0),
    session_id: text("session_id").references(() => chatSessions.id, { onDelete: "set null" }),
    message_id: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    // The turn this cost belongs to; NULL on legacy rows.
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
