import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { appConfig } from "../config";

// Resolve data directory relative to project root (app/../data)
const PROJECT_ROOT = join(dirname(import.meta.dir), "..", "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const DEFAULT_DB_PATH = join(DATA_DIR, "app.db");
const DB_PATH = appConfig.server.database_url.startsWith("/")
  ? appConfig.server.database_url
  : join(PROJECT_ROOT, appConfig.server.database_url);

// Ensure data directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create database connection
const db = new Database(DB_PATH, { create: true });

// Enable foreign key enforcement (MUST run on each connection)
db.run("PRAGMA foreign_keys = ON");

// Enable WAL mode for better concurrent read performance
db.run("PRAGMA journal_mode = WAL");

/**
 * Initialize database schema from schema.sql
 */
export function initializeSchema(): void {
  const schemaPath = join(import.meta.dir, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  console.log("Database schema initialized at:", DB_PATH);
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
  findByClerkId(clerkId: string) {
    return stmt("SELECT * FROM users WHERE clerk_id = ?").get(clerkId);
  },

  findByEmail(email: string) {
    return stmt("SELECT * FROM users WHERE email = ?").get(email);
  },

  findById(id: string) {
    return stmt("SELECT * FROM users WHERE id = ?").get(id);
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

  findByEmail(email: string) {
    return stmt("SELECT * FROM access_requests WHERE email = ?").get(email);
  },

  findPending() {
    return stmt(
      "SELECT * FROM access_requests WHERE status = 'pending' ORDER BY submitted_at DESC"
    ).all();
  },

  findById(id: string) {
    return stmt("SELECT * FROM access_requests WHERE id = ?").get(id);
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

  findAll() {
    return stmt(
      "SELECT * FROM access_requests ORDER BY submitted_at DESC"
    ).all();
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

  findByUserId(userId: string) {
    return stmt(
      "SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(userId);
  },

  findById(id: string) {
    return stmt("SELECT * FROM chat_sessions WHERE id = ?").get(id);
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
    toolCalls: string | null
  ) {
    return stmt(
      `INSERT INTO messages (id, chat_id, role, content, tool_calls)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, chatId, role, content, toolCalls);
  },

  findByChatId(chatId: string) {
    return stmt("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC").all(chatId);
  },

  findById(id: string) {
    return stmt("SELECT * FROM messages WHERE id = ?").get(id);
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

  /** Get today's usage without incrementing */
  getToday(userId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const row = stmt(
      "SELECT query_count FROM daily_usage WHERE user_id = ? AND date = ?"
    ).get(userId, today) as { query_count: number } | undefined;
    return row?.query_count ?? 0;
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
