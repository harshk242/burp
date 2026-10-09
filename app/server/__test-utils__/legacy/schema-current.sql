-- FROZEN legacy fixture: app/server/db/schema.sql as of 565578c (pre-Drizzle). Do not edit.
-- SQLite with foreign key enforcement

-- IMPORTANT: Enable foreign key enforcement (must run on each connection)
PRAGMA foreign_keys = ON;

-- Users (synced from Clerk)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  image_url TEXT,
  role TEXT DEFAULT 'waitlist' CHECK (role IN ('waitlist', 'user', 'admin')),
  institution TEXT,
  research_area TEXT,
  total_queries INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  last_active_at INTEGER,
  -- Per-user rate limit overrides (NULL = use role/config default)
  daily_query_limit INTEGER,
  daily_token_limit INTEGER,
  daily_cost_limit_microusd INTEGER,
  monthly_cost_limit_microusd INTEGER
);

-- Access requests (waitlist)
CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  institution TEXT,
  research_area TEXT,
  use_case TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at INTEGER DEFAULT (unixepoch()),
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER
);

-- Messages (cascade delete when chat is deleted)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT,
  tool_calls TEXT, -- JSON array of tool calls
  created_at INTEGER DEFAULT (unixepoch()),
  -- Token counts per assistant message (0 for user messages and pre-migration rows)
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  -- Reasoning text (pre-tool-call text) stored separately to avoid model context contamination
  reasoning TEXT,
  -- Dollar cost charged for this assistant turn (main chat model only)
  cost_microusd INTEGER DEFAULT 0
);

-- Daily usage tracking (one row per user per day)
CREATE TABLE IF NOT EXISTS daily_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  query_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  -- Token aggregates for today (best-effort: incremented post-response)
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- Configurable rate limits per role
CREATE TABLE IF NOT EXISTS rate_limits (
  role TEXT PRIMARY KEY CHECK (role IN ('user', 'admin')),
  daily_limit INTEGER NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Seed default rate limits
INSERT OR IGNORE INTO rate_limits (role, daily_limit) VALUES ('user', 50);
INSERT OR IGNORE INTO rate_limits (role, daily_limit) VALUES ('admin', -1);  -- -1 = unlimited

-- Per-query usage ledger for main chat model billing
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  month TEXT NOT NULL,            -- YYYY-MM (UTC)
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
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_date ON usage_events(user_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_month ON usage_events(user_id, month);
CREATE INDEX IF NOT EXISTS idx_usage_events_message_id ON usage_events(message_id);

-- Full-text search index for hybrid tool search (BM25 + semantic)
CREATE VIRTUAL TABLE IF NOT EXISTS tool_search_fts USING fts5(
  full_name,
  server,
  tool_name,
  description,
  tokenize='porter unicode61'
);

-- ── Live-DB Migrations ────────────────────────────────────────────────────────
-- These ALTER TABLE statements are idempotent when run via the applyMigrations()
-- helper in db/index.ts (which wraps each in try/catch). They are NO-OPs on a
-- fresh install because the columns already exist in the CREATE TABLE above.
--
-- ALTER TABLE users ADD COLUMN daily_query_limit INTEGER;
-- ALTER TABLE users ADD COLUMN daily_token_limit INTEGER;
-- ALTER TABLE users ADD COLUMN daily_cost_limit_microusd INTEGER;
-- ALTER TABLE users ADD COLUMN monthly_cost_limit_microusd INTEGER;
-- ALTER TABLE daily_usage ADD COLUMN input_tokens INTEGER DEFAULT 0;
-- ALTER TABLE daily_usage ADD COLUMN output_tokens INTEGER DEFAULT 0;
-- ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT 0;
-- ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT 0;
-- ALTER TABLE messages ADD COLUMN reasoning TEXT;
-- ALTER TABLE messages ADD COLUMN cost_microusd INTEGER DEFAULT 0;
