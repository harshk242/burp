import { readFileSync } from "fs";
import { join } from "path";
import type { DbUser, DbAccessRequest, DbChatSession, DbMessageRow, DbUsageEvent } from "../types";
// Shared connection (path resolution + pragmas live in paths.ts / connection.ts).
import { DB_PATH, sqlite as db } from "./client";

/**
 * Initialize database schema from schema.sql
 */
export function initializeSchema(): void {
  const schemaPath = join(import.meta.dir, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  applyMigrations();
  console.log("Database schema initialized at:", DB_PATH);
}

/**
 * Idempotent migrations for live databases.
 * SQLite does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
 * so each statement is wrapped in try/catch — already-existing columns
 * produce "duplicate column name" errors that are safely ignored.
 */
function applyMigrations(): void {
  const migrations: string[] = [
    "ALTER TABLE users ADD COLUMN daily_query_limit INTEGER",
    "ALTER TABLE users ADD COLUMN daily_token_limit INTEGER",
    "ALTER TABLE users ADD COLUMN daily_cost_limit_microusd INTEGER",
    "ALTER TABLE users ADD COLUMN monthly_cost_limit_microusd INTEGER",
    "ALTER TABLE daily_usage ADD COLUMN input_tokens INTEGER DEFAULT 0",
    "ALTER TABLE daily_usage ADD COLUMN output_tokens INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN reasoning TEXT",
    "ALTER TABLE messages ADD COLUMN cost_microusd INTEGER DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      month TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'chat' CHECK (operation = 'chat'),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      input_cost_per_mtok_microusd INTEGER NOT NULL,
      output_cost_per_mtok_microusd INTEGER NOT NULL,
      cost_microusd INTEGER NOT NULL DEFAULT 0,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    "CREATE INDEX IF NOT EXISTS idx_usage_events_user_date ON usage_events(user_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_usage_events_user_month ON usage_events(user_id, month)",
    "CREATE INDEX IF NOT EXISTS idx_usage_events_message_id ON usage_events(message_id)",
    "UPDATE users SET role = 'user' WHERE role = 'waitlist'",
  ];
  for (const sql of migrations) {
    try {
      db.run(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }
}

// Lazy statement cache to avoid preparing before schema exists
const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();

function stmt<T = unknown>(sql: string): ReturnType<typeof db.prepare<T, any[]>> {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, db.prepare(sql));
  }
  return stmtCache.get(sql)! as ReturnType<typeof db.prepare<T, any[]>>;
}

/**
 * User queries
 */
export const userQueries = {
  findByClerkId(clerkId: string): DbUser | null {
    return stmt("SELECT * FROM users WHERE clerk_id = ?").get(clerkId) as DbUser | null;
  },

  findByEmail(email: string): DbUser | null {
    return stmt("SELECT * FROM users WHERE email = ?").get(email) as DbUser | null;
  },

  findById(id: string): DbUser | null {
    return stmt("SELECT * FROM users WHERE id = ?").get(id) as DbUser | null;
  },

  create(
    id: string,
    clerkId: string,
    email: string,
    name: string | null,
    imageUrl: string | null,
    role: string,
    institution: string | null,
    researchArea: string | null
  ) {
    return stmt(
      `INSERT INTO users (id, clerk_id, email, name, image_url, role, institution, research_area)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, clerkId, email, name, imageUrl, role, institution, researchArea);
  },

  updateLastActive(id: string) {
    return stmt("UPDATE users SET last_active_at = unixepoch() WHERE id = ?").run(id);
  },

  incrementQueries(id: string) {
    return stmt("UPDATE users SET total_queries = total_queries + 1 WHERE id = ?").run(id);
  },

  updateRole(id: string, role: string) {
    return stmt("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  },

  /** Set per-user limits. Pass null to clear override (revert to defaults). */
  updateLimits(
    id: string,
    dailyQueryLimit: number | null,
    dailyTokenLimit: number | null,
    dailyCostLimitMicrousd: number | null,
    monthlyCostLimitMicrousd: number | null
  ) {
    return stmt(
      `UPDATE users
       SET daily_query_limit = ?,
           daily_token_limit = ?,
           daily_cost_limit_microusd = ?,
           monthly_cost_limit_microusd = ?
       WHERE id = ?`
    ).run(dailyQueryLimit, dailyTokenLimit, dailyCostLimitMicrousd, monthlyCostLimitMicrousd, id);
  },

  /** List all users for the admin panel (with limit overrides). */
  listAll(): DbUser[] {
    return stmt(
      "SELECT * FROM users ORDER BY created_at DESC"
    ).all() as DbUser[];
  },
};

/**
 * Access request queries
 */
export const accessRequestQueries = {
  create(
    id: string,
    email: string,
    name: string,
    institution: string | null,
    researchArea: string | null,
    useCase: string | null
  ) {
    return stmt(
      `INSERT INTO access_requests (id, email, name, institution, research_area, use_case)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, email, name, institution, researchArea, useCase);
  },

  findByEmail(email: string): DbAccessRequest | null {
    return stmt("SELECT * FROM access_requests WHERE email = ?").get(email) as DbAccessRequest | null;
  },

  findPending(): DbAccessRequest[] {
    return stmt(
      "SELECT * FROM access_requests WHERE status = 'pending' ORDER BY submitted_at DESC"
    ).all() as DbAccessRequest[];
  },

  findById(id: string): DbAccessRequest | null {
    return stmt("SELECT * FROM access_requests WHERE id = ?").get(id) as DbAccessRequest | null;
  },

  approve(id: string, reviewedBy: string | null) {
    return stmt(
      "UPDATE access_requests SET status = 'approved', reviewed_at = unixepoch(), reviewed_by = ? WHERE id = ?"
    ).run(reviewedBy, id);
  },

  reject(id: string, reviewedBy: string | null) {
    return stmt(
      "UPDATE access_requests SET status = 'rejected', reviewed_at = unixepoch(), reviewed_by = ? WHERE id = ?"
    ).run(reviewedBy, id);
  },

  findAll(): DbAccessRequest[] {
    return stmt(
      "SELECT * FROM access_requests ORDER BY submitted_at DESC"
    ).all() as DbAccessRequest[];
  },
};

/**
 * Chat session queries
 */
export const chatSessionQueries = {
  create(id: string, userId: string, title: string | null) {
    return stmt(
      `INSERT INTO chat_sessions (id, user_id, title, updated_at)
       VALUES (?, ?, ?, unixepoch())`
    ).run(id, userId, title);
  },

  findByUserId(userId: string): DbChatSession[] {
    return stmt(
      "SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(userId) as DbChatSession[];
  },

  findById(id: string): DbChatSession | null {
    return stmt("SELECT * FROM chat_sessions WHERE id = ?").get(id) as DbChatSession | null;
  },

  updateTitle(id: string, title: string) {
    return stmt(
      "UPDATE chat_sessions SET title = ?, updated_at = unixepoch() WHERE id = ?"
    ).run(title, id);
  },

  touch(id: string) {
    return stmt("UPDATE chat_sessions SET updated_at = unixepoch() WHERE id = ?").run(id);
  },

  delete(id: string) {
    return stmt("DELETE FROM chat_sessions WHERE id = ?").run(id);
  },
};

/**
 * Message queries
 */
export const messageQueries = {
  create(
    id: string,
    chatId: string,
    role: string,
    content: string | null,
    toolCalls: string | null,
    inputTokens: number = 0,
    outputTokens: number = 0,
    reasoning: string | null = null,
    costMicrousd: number = 0
  ) {
    return stmt(
      `INSERT INTO messages (id, chat_id, role, content, tool_calls, input_tokens, output_tokens, reasoning, cost_microusd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, chatId, role, content, toolCalls, inputTokens, outputTokens, reasoning, costMicrousd);
  },

  findByChatId(chatId: string): DbMessageRow[] {
    return stmt("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC").all(chatId) as DbMessageRow[];
  },

  findById(id: string): DbMessageRow | null {
    return stmt("SELECT * FROM messages WHERE id = ?").get(id) as DbMessageRow | null;
  },
};

/**
 * Daily usage queries (rate limiting)
 */
export const dailyUsageQueries = {
  /** Increment today's usage and return new count */
  incrementAndGet(userId: string): number {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    stmt(
      `INSERT INTO daily_usage (user_id, date, query_count)
       VALUES (?, ?, 1)
       ON CONFLICT(user_id, date) DO UPDATE SET query_count = query_count + 1`
    ).run(userId, today);
    const row = stmt(
      "SELECT query_count FROM daily_usage WHERE user_id = ? AND date = ?"
    ).get(userId, today) as { query_count: number } | undefined;
    return row?.query_count ?? 1;
  },

  /** Get today's query count without incrementing */
  getToday(userId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const row = stmt(
      "SELECT query_count FROM daily_usage WHERE user_id = ? AND date = ?"
    ).get(userId, today) as { query_count: number } | undefined;
    return row?.query_count ?? 0;
  },

  /** Get today's full usage row: query count + token totals */
  getTodayFull(userId: string): { query_count: number; input_tokens: number; output_tokens: number } {
    const today = new Date().toISOString().slice(0, 10);
    const row = stmt(
      "SELECT query_count, input_tokens, output_tokens FROM daily_usage WHERE user_id = ? AND date = ?"
    ).get(userId, today) as { query_count: number; input_tokens: number; output_tokens: number } | undefined;
    return row ?? { query_count: 0, input_tokens: 0, output_tokens: 0 };
  },

  /**
   * Add token counts for today's usage row (best-effort, called post-response).
   * Token enforcement is checked pre-request via getTodayFull; incremented here
   * after the response completes — up to 1 request of overshoot is possible.
   */
  incrementTokens(userId: string, inputTokens: number, outputTokens: number): void {
    const today = new Date().toISOString().slice(0, 10);
    stmt(
      `INSERT INTO daily_usage (user_id, date, query_count, input_tokens, output_tokens)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens`
    ).run(userId, today, inputTokens, outputTokens);
  },
};

/**
 * Main chat usage cost ledger queries.
 */
export const usageEventQueries = {
  create(event: Omit<DbUsageEvent, "created_at">): void {
    stmt(
      `INSERT INTO usage_events (
        id,
        user_id,
        date,
        month,
        operation,
        provider,
        model,
        input_tokens,
        output_tokens,
        input_cost_per_mtok_microusd,
        output_cost_per_mtok_microusd,
        cost_microusd,
        session_id,
        message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.user_id,
      event.date,
      event.month,
      event.operation,
      event.provider,
      event.model,
      event.input_tokens,
      event.output_tokens,
      event.input_cost_per_mtok_microusd,
      event.output_cost_per_mtok_microusd,
      event.cost_microusd,
      event.session_id,
      event.message_id
    );
  },

  getTotalsForDate(userId: string, date = new Date().toISOString().slice(0, 10)) {
    const row = stmt(
      `SELECT
         COALESCE(SUM(cost_microusd), 0) AS cost_microusd,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COUNT(*) AS query_count
       FROM usage_events
       WHERE user_id = ? AND date = ?`
    ).get(userId, date) as { cost_microusd: number; input_tokens: number; output_tokens: number; query_count: number };
    return row;
  },

  getTotalsForMonth(userId: string, month = new Date().toISOString().slice(0, 7)) {
    const row = stmt(
      `SELECT
         COALESCE(SUM(cost_microusd), 0) AS cost_microusd,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COUNT(*) AS query_count
       FROM usage_events
       WHERE user_id = ? AND month = ?`
    ).get(userId, month) as { cost_microusd: number; input_tokens: number; output_tokens: number; query_count: number };
    return row;
  },
};

/**
 * Rate limit queries
 */
export const rateLimitQueries = {
  getForRole(role: string): number {
    const row = stmt(
      "SELECT daily_limit FROM rate_limits WHERE role = ?"
    ).get(role) as { daily_limit: number } | undefined;
    if (!row) return role === "admin" ? -1 : 50;
    return row.daily_limit;
  },

  update(role: string, dailyLimit: number) {
    return stmt(
      `INSERT INTO rate_limits (role, daily_limit, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(role) DO UPDATE SET daily_limit = ?, updated_at = unixepoch()`
    ).run(role, dailyLimit, dailyLimit);
  },
};

/**
 * Tool search queries (FTS5 for hybrid BM25 search)
 */
export const toolSearchQueries = {
  clearAll() {
    db.run("DELETE FROM tool_search_fts");
  },

  insertTool(fullName: string, server: string, toolName: string, description: string) {
    stmt(
      "INSERT INTO tool_search_fts (full_name, server, tool_name, description) VALUES (?, ?, ?, ?)"
    ).run(fullName, server, toolName, description);
  },

  searchBM25(
    query: string,
    limit: number = 20
  ): Array<{ full_name: string; server: string; tool_name: string; description: string; rank: number }> {
    return stmt(
      `SELECT full_name, server, tool_name, description, rank
       FROM tool_search_fts
       WHERE tool_search_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    ).all(query, limit) as Array<{
      full_name: string;
      server: string;
      tool_name: string;
      description: string;
      rank: number;
    }>;
  },
};

export { db };
