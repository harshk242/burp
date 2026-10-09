/**
 * users + access_requests.
 *
 * Schema rules (see plans/drizzle-orm-migration.md §4, §5):
 * - property keys are the snake_case column names (rows are returned by the API as-is);
 * - every column the API treats as non-null is NOT NULL (tightened by 0003; the
 *   nullable legacy baseline lives on only in migrations/0000_baseline.sql);
 * - text PKs are column-level `.primaryKey()` (emits `PRIMARY KEY NOT NULL`);
 * - CHECK bodies are raw, unqualified SQL so they normalize like legacy inline CHECKs.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    clerk_id: text("clerk_id").notNull().unique(),
    email: text("email").notNull().unique(),
    name: text("name"),
    image_url: text("image_url"),
    role: text("role", { enum: ["waitlist", "user", "admin"] }).notNull().default("waitlist"),
    institution: text("institution"),
    research_area: text("research_area"),
    total_queries: integer("total_queries").notNull().default(0),
    created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
    last_active_at: integer("last_active_at"),
    // Per-user rate limit overrides (NULL = use role/config default)
    daily_query_limit: integer("daily_query_limit"),
    daily_token_limit: integer("daily_token_limit"),
    daily_cost_limit_microusd: integer("daily_cost_limit_microusd"),
    monthly_cost_limit_microusd: integer("monthly_cost_limit_microusd"),
  },
  (t) => [
    check("users_role_check", sql`role IN ('waitlist', 'user', 'admin')`),
    // Redundant with the UNIQUE indexes; kept for parity with legacy DBs.
    index("idx_users_clerk_id").on(t.clerk_id),
    index("idx_users_email").on(t.email),
  ],
);

export const accessRequests = sqliteTable(
  "access_requests",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    institution: text("institution"),
    research_area: text("research_area"),
    use_case: text("use_case"),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    submitted_at: integer("submitted_at").notNull().default(sql`(unixepoch())`),
    reviewed_at: integer("reviewed_at"),
    reviewed_by: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check("access_requests_status_check", sql`status IN ('pending', 'approved', 'rejected')`),
    index("idx_access_requests_email").on(t.email),
    index("idx_access_requests_status").on(t.status),
  ],
);
