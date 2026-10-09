/**
 * Legacy (pre-Drizzle) database fixtures for adoption tests (plans §10).
 *
 * - "current":   the frozen copy of the last schema.sql (trashed in the Drizzle cutover), as a fresh install built it.
 * - "old prod":  the frozen pre-ALTER schema.sql + rows, then the old boot's ALTER
 *                list — ALTER-appended columns land after table constraints in the DDL.
 * - "reordered": current schema with `users`/`messages` columns declared in a
 *                different order, to prove the rebuild copies columns by name.
 *
 * All contain inline (anonymous) UNIQUEs, an FTS5 table and seeded rows.
 */
import type { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { LEGACY_CATCH_UP } from "../db/legacy";

export const CURRENT_LEGACY_SQL = readFileSync(join(import.meta.dir, "legacy", "schema-current.sql"), "utf-8");
export const OLD_PROD_LEGACY_SQL = readFileSync(join(import.meta.dir, "legacy", "schema-old-prod.sql"), "utf-8");

export type LegacyFixture = "current" | "old-prod" | "reordered";
export const LEGACY_FIXTURES: LegacyFixture[] = ["current", "old-prod", "reordered"];

const REORDERED_USERS = `CREATE TABLE IF NOT EXISTS users (
  monthly_cost_limit_microusd INTEGER,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'waitlist' CHECK (role IN ('waitlist', 'user', 'admin')),
  daily_token_limit INTEGER,
  name TEXT,
  id TEXT PRIMARY KEY,
  clerk_id TEXT UNIQUE NOT NULL,
  research_area TEXT,
  daily_cost_limit_microusd INTEGER,
  image_url TEXT,
  last_active_at INTEGER,
  institution TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  daily_query_limit INTEGER,
  total_queries INTEGER DEFAULT 0
);`;

const REORDERED_MESSAGES = `CREATE TABLE IF NOT EXISTS messages (
  cost_microusd INTEGER DEFAULT 0,
  reasoning TEXT,
  content TEXT,
  id TEXT PRIMARY KEY,
  output_tokens INTEGER DEFAULT 0,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  chat_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  tool_calls TEXT,
  input_tokens INTEGER DEFAULT 0
);`;

/** The `CREATE TABLE IF NOT EXISTS <table> (...);` block of a schema script. */
function tableBlock(schemaSql: string, table: string): string {
  const block = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`).exec(schemaSql)?.[0];
  if (!block) throw new Error(`table ${table} not found in fixture schema`);
  return block;
}

/** Replace one table's CREATE block of a schema script. */
export function replaceTable(schemaSql: string, table: string, ddl: string): string {
  return schemaSql.replace(tableBlock(schemaSql, table), ddl);
}

/** Replace `from` with `to` inside one table's CREATE block only (for negative fixtures). */
export function mutateTable(schemaSql: string, table: string, from: string, to: string): string {
  const block = tableBlock(schemaSql, table);
  if (!block.includes(from)) throw new Error(`"${from}" not found in ${table}`);
  return schemaSql.replace(block, block.replace(from, to));
}

export interface BuildLegacyOptions {
  /** Schema script to run instead of the fixture's own (negative cases). */
  schemaSql?: string;
  /** Seed the fixture rows (default true). Off for schemas that would reject them. */
  seed?: boolean;
}

/** Build a legacy fixture into an empty connection (FK enforcement as the old app had it). */
export function buildLegacyDb(sqlite: Database, fixture: LegacyFixture, options: BuildLegacyOptions = {}): void {
  const { schemaSql, seed = true } = options;
  if (fixture === "old-prod") {
    sqlite.exec(schemaSql ?? OLD_PROD_LEGACY_SQL);
    if (seed) seedCoreRows(sqlite);
    // The old boot: try/catch ALTER list (every error swallowed, as it was).
    for (const statement of LEGACY_CATCH_UP) {
      try {
        sqlite.run(statement);
      } catch {
        // duplicate column — ignored by the old code
      }
    }
  } else {
    let sql = schemaSql ?? CURRENT_LEGACY_SQL;
    if (fixture === "reordered" && !schemaSql) {
      sql = replaceTable(replaceTable(sql, "users", REORDERED_USERS), "messages", REORDERED_MESSAGES);
    }
    sqlite.exec(sql);
    if (seed) seedCoreRows(sqlite);
  }
  if (seed) seedLaterRows(sqlite);
}

/** Rows that fit the pre-ALTER schema too. */
function seedCoreRows(sqlite: Database): void {
  sqlite.run(`INSERT INTO users (id, clerk_id, email, name, role, total_queries, created_at) VALUES
    ('u-admin', 'clerk_admin', 'admin@example.com', 'Admin', 'admin', 7, 1700000000),
    ('u-user', 'clerk_user', 'user@example.com', NULL, 'user', 3, 1700000100)`);
  sqlite.run(`INSERT INTO access_requests (id, email, name, institution, status, reviewed_by) VALUES
    ('ar-1', 'req@example.com', 'Req', 'MIT', 'approved', 'u-admin'),
    ('ar-2', 'other@example.com', 'Other', NULL, 'pending', NULL)`);
  sqlite.run(`INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES
    ('c-1', 'u-user', 'Proteins', 1700000200, 1700000300),
    ('c-2', 'u-admin', NULL, 1700000400, NULL)`);
  sqlite.run(`INSERT INTO messages (id, chat_id, role, content, tool_calls, created_at) VALUES
    ('m-1', 'c-1', 'user', 'What is TP53?', NULL, 1700000200),
    ('m-2', 'c-1', 'assistant', 'A tumour suppressor.', '[{"name":"search"}]', 1700000200),
    ('m-3', 'c-2', 'user', 'hi', NULL, 1700000400)`);
  sqlite.run(`INSERT INTO daily_usage (user_id, date, query_count) VALUES
    ('u-user', '2026-01-01', 2), ('u-user', '2026-01-02', 1), ('u-admin', '2026-01-02', 5)`);
  // Leave an AUTOINCREMENT gap: sqlite_sequence (3) is now above max(id) (2).
  sqlite.run("DELETE FROM daily_usage WHERE user_id = 'u-admin'");
  sqlite.run(
    "INSERT INTO tool_search_fts (full_name, server, tool_name, description) VALUES ('s.t', 's', 't', 'searching proteins')",
  );
}

/** Rows that need the ALTER-added columns / usage_events. */
function seedLaterRows(sqlite: Database): void {
  sqlite.run(`INSERT INTO users (id, clerk_id, email, role, daily_cost_limit_microusd, created_at) VALUES
    ('u-wait', 'clerk_wait', 'wait@example.com', 'waitlist', 5000000, 1700000500)`);
  sqlite.run("UPDATE messages SET input_tokens = 120, output_tokens = 45, cost_microusd = 900, reasoning = 'r' WHERE id = 'm-2'");
  sqlite.run("UPDATE daily_usage SET input_tokens = 120, output_tokens = 45 WHERE date = '2026-01-01'");
  sqlite.run(`INSERT INTO usage_events (id, user_id, date, month, provider, model, input_tokens, output_tokens,
      input_cost_per_mtok_microusd, output_cost_per_mtok_microusd, cost_microusd, session_id, message_id, created_at)
    VALUES ('e-1', 'u-user', '2026-01-01', '2026-01', 'anthropic', 'claude', 120, 45, 3000000, 15000000, 900, 'c-1', 'm-2', 1700000250)`);
}

/** Every row of the 7 tables keyed by rowid, column order-independent. */
export function dumpRows(sqlite: Database): Record<string, Array<Record<string, unknown>>> {
  const tables = ["access_requests", "chat_sessions", "daily_usage", "messages", "rate_limits", "usage_events", "users"];
  return Object.fromEntries(
    tables.map((t) => [
      t,
      sqlite
        .query<Record<string, unknown>, []>(`SELECT rowid AS __rowid, * FROM ${t} ORDER BY rowid`)
        .all()
        .map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))),
    ]),
  );
}

export function sequenceOf(sqlite: Database, table: string): number | null {
  return sqlite.query<{ seq: number }, [string]>("SELECT seq FROM sqlite_sequence WHERE name = ?").get(table)?.seq ?? null;
}
