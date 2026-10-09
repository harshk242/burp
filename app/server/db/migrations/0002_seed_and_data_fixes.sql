-- Custom SQL migration file, put your code below! --
-- One statement per breakpoint: drizzle-orm prepares each chunk, so extra statements in a chunk are dropped.
-- Seed default rate limits (idempotent on legacy DBs that already have them).
INSERT OR IGNORE INTO rate_limits (role, daily_limit) VALUES ('user', 50);
--> statement-breakpoint
-- -1 = unlimited
INSERT OR IGNORE INTO rate_limits (role, daily_limit) VALUES ('admin', -1);
--> statement-breakpoint
-- The waitlist gate is retired: every waitlisted account becomes a regular user (legacy applyMigrations()).
UPDATE users SET role = 'user' WHERE role = 'waitlist';
