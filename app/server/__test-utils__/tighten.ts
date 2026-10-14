import type { Database } from "bun:sqlite";

/** One row per tightened table with every backfillable column NULL. */
export function seedNullableRows(sqlite: Database): void {
  sqlite.run(`INSERT INTO users (id, clerk_id, email, role, total_queries, created_at)
    VALUES ('u-null', 'clerk_null', 'null@example.com', NULL, NULL, NULL)`);
  sqlite.run(`INSERT INTO access_requests (id, email, name, status, submitted_at)
    VALUES ('ar-null', 'null-req@example.com', 'Null', NULL, NULL)`);
  sqlite.run("INSERT INTO chat_sessions (id, user_id, created_at) VALUES ('c-null', 'u-null', NULL)");
  sqlite.run(`INSERT INTO messages (id, chat_id, role, created_at, input_tokens, output_tokens, cost_microusd)
    VALUES ('m-null', 'c-null', 'assistant', NULL, NULL, NULL, NULL)`);
  sqlite.run(`INSERT INTO daily_usage (user_id, date, query_count, created_at, input_tokens, output_tokens)
    VALUES ('u-null', '2026-03-01', NULL, NULL, NULL, NULL)`);
  sqlite.run(`INSERT INTO usage_events (id, user_id, date, month, provider, model,
      input_cost_per_mtok_microusd, output_cost_per_mtok_microusd, session_id, message_id, created_at)
    VALUES ('e-null', 'u-null', '2026-03-01', '2026-03', 'anthropic', 'claude', 1, 1, 'c-null', 'm-null', NULL)`);
  sqlite.run("INSERT OR REPLACE INTO rate_limits (role, daily_limit, updated_at) VALUES ('user', 50, NULL)");
}

/** A row with a NULL primary key, per table (needs `u-user` and `c-1`). */
export const NULL_PK_INSERTS: Record<string, string> = {
  users: "INSERT INTO users (id, clerk_id, email, role) VALUES (NULL, 'clerk_nopk', 'nopk@example.com', 'user')",
  access_requests: "INSERT INTO access_requests (id, email, name) VALUES (NULL, 'nopk-req@example.com', 'NoPk')",
  chat_sessions: "INSERT INTO chat_sessions (id, user_id) VALUES (NULL, 'u-user')",
  messages: "INSERT INTO messages (id, chat_id, role) VALUES (NULL, 'c-1', 'user')",
  usage_events: `INSERT INTO usage_events (id, user_id, date, month, provider, model,
      input_cost_per_mtok_microusd, output_cost_per_mtok_microusd)
    VALUES (NULL, 'u-user', '2026-03-01', '2026-03', 'anthropic', 'claude', 1, 1)`,
  rate_limits: "INSERT INTO rate_limits (role, daily_limit) VALUES (NULL, 5)",
};

export function autoindexes(sqlite: Database): string[] {
  return sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name LIKE 'sqlite_autoindex_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

type ColumnInfo = { name: string; notnull: number };

/** `table.column` for every NOT NULL column (a text PK without NOT NULL is still nullable). */
export function notNullColumns(sqlite: Database, tables: string[]): string[] {
  return tables
    .flatMap((t) =>
      sqlite
        .query<ColumnInfo, []>(`PRAGMA table_info("${t}")`)
        .all()
        .filter((c) => c.notnull === 1)
        .map((c) => `${t}.${c.name}`),
    )
    .sort();
}
