/**
 * daily_usage, rate_limits, usage_events (rules in ./users.ts).
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { chatSessions, messages } from "./chat";
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
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    input_cost_per_mtok_microusd: integer("input_cost_per_mtok_microusd").notNull(),
    output_cost_per_mtok_microusd: integer("output_cost_per_mtok_microusd").notNull(),
    cost_microusd: integer("cost_microusd").notNull().default(0),
    session_id: text("session_id").references(() => chatSessions.id, { onDelete: "set null" }),
    message_id: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    check("usage_events_operation_check", sql`operation = 'chat'`),
    index("idx_usage_events_user_date").on(t.user_id, t.date),
    index("idx_usage_events_user_month").on(t.user_id, t.month),
    index("idx_usage_events_message_id").on(t.message_id),
  ],
);
