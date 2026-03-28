-- Super Bio Agent Database Schema
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
  last_active_at INTEGER
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
  created_at INTEGER DEFAULT (unixepoch())
);

-- Daily usage tracking (one row per user per day)
CREATE TABLE IF NOT EXISTS daily_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  query_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage(user_id, date);
