-- Hand-edited (plans/drizzle-orm-migration.md §5). Generated recreate statements below the backfills.
-- One statement per breakpoint: drizzle-orm prepares each chunk, so extra statements in a chunk are dropped.
-- Keep the backfills in sync with server/db/backfills.ts (db:verify reports their counts; a test checks both match).
--
-- Backfills: fill every NULL that can safely be filled before the copies below tighten the columns.
-- NULL `id` / `rate_limits.role` primary keys are deliberately NOT backfilled: the copy then fails with
-- "NOT NULL constraint failed" and the whole migration transaction (including legacy adoption) rolls back.
--
-- The generated `PRAGMA foreign_keys` lines are no-ops inside the migration transaction; runMigrations()
-- turns FKs off before BEGIN so `DROP TABLE` doesn't cascade, and runs foreign_key_check before COMMIT.

-- NULL role was an accidental lockout; 'user' matches 0002 and the login upgrade
UPDATE `users` SET `role` = 'user' WHERE `role` IS NULL;
--> statement-breakpoint
UPDATE `users` SET `total_queries` = 0 WHERE `total_queries` IS NULL;
--> statement-breakpoint
-- unknown original time
UPDATE `users` SET `created_at` = unixepoch() WHERE `created_at` IS NULL;
--> statement-breakpoint
UPDATE `access_requests` SET `status` = 'pending' WHERE `status` IS NULL;
--> statement-breakpoint
UPDATE `access_requests` SET `submitted_at` = unixepoch() WHERE `submitted_at` IS NULL;
--> statement-breakpoint
UPDATE `chat_sessions` SET `created_at` = unixepoch() WHERE `created_at` IS NULL;
--> statement-breakpoint
UPDATE `messages` SET `created_at` = unixepoch() WHERE `created_at` IS NULL;
--> statement-breakpoint
UPDATE `messages` SET `input_tokens` = 0 WHERE `input_tokens` IS NULL;
--> statement-breakpoint
UPDATE `messages` SET `output_tokens` = 0 WHERE `output_tokens` IS NULL;
--> statement-breakpoint
UPDATE `messages` SET `cost_microusd` = 0 WHERE `cost_microusd` IS NULL;
--> statement-breakpoint
UPDATE `usage_events` SET `created_at` = unixepoch() WHERE `created_at` IS NULL;
--> statement-breakpoint
UPDATE `daily_usage` SET `query_count` = 0 WHERE `query_count` IS NULL;
--> statement-breakpoint
UPDATE `daily_usage` SET `created_at` = unixepoch() WHERE `created_at` IS NULL;
--> statement-breakpoint
UPDATE `daily_usage` SET `input_tokens` = 0 WHERE `input_tokens` IS NULL;
--> statement-breakpoint
UPDATE `daily_usage` SET `output_tokens` = 0 WHERE `output_tokens` IS NULL;
--> statement-breakpoint
UPDATE `rate_limits` SET `updated_at` = unixepoch() WHERE `updated_at` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`research_area` text,
	`use_case` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "access_requests_status_check" CHECK(status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_access_requests`("id", "email", "name", "institution", "research_area", "use_case", "status", "submitted_at", "reviewed_at", "reviewed_by") SELECT "id", "email", "name", "institution", "research_area", "use_case", "status", "submitted_at", "reviewed_at", "reviewed_by" FROM `access_requests`;--> statement-breakpoint
DROP TABLE `access_requests`;--> statement-breakpoint
ALTER TABLE `__new_access_requests` RENAME TO `access_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `access_requests_email_unique` ON `access_requests` (`email`);--> statement-breakpoint
CREATE INDEX `idx_access_requests_email` ON `access_requests` (`email`);--> statement-breakpoint
CREATE INDEX `idx_access_requests_status` ON `access_requests` (`status`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`image_url` text,
	`role` text DEFAULT 'waitlist' NOT NULL,
	`institution` text,
	`research_area` text,
	`total_queries` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_active_at` integer,
	`daily_query_limit` integer,
	`daily_token_limit` integer,
	`daily_cost_limit_microusd` integer,
	`monthly_cost_limit_microusd` integer,
	CONSTRAINT "users_role_check" CHECK(role IN ('waitlist', 'user', 'admin'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "clerk_id", "email", "name", "image_url", "role", "institution", "research_area", "total_queries", "created_at", "last_active_at", "daily_query_limit", "daily_token_limit", "daily_cost_limit_microusd", "monthly_cost_limit_microusd") SELECT "id", "clerk_id", "email", "name", "image_url", "role", "institution", "research_area", "total_queries", "created_at", "last_active_at", "daily_query_limit", "daily_token_limit", "daily_cost_limit_microusd", "monthly_cost_limit_microusd" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_id_unique` ON `users` (`clerk_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_clerk_id` ON `users` (`clerk_id`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `__new_chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_chat_sessions`("id", "user_id", "title", "created_at", "updated_at") SELECT "id", "user_id", "title", "created_at", "updated_at" FROM `chat_sessions`;--> statement-breakpoint
DROP TABLE `chat_sessions`;--> statement-breakpoint
ALTER TABLE `__new_chat_sessions` RENAME TO `chat_sessions`;--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_user_id` ON `chat_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text,
	`tool_calls` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning` text,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_role_check" CHECK(role IN ('user', 'assistant'))
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "chat_id", "role", "content", "tool_calls", "created_at", "input_tokens", "output_tokens", "reasoning", "cost_microusd") SELECT "id", "chat_id", "role", "content", "tool_calls", "created_at", "input_tokens", "output_tokens", "reasoning", "cost_microusd" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `idx_messages_chat_id` ON `messages` (`chat_id`);--> statement-breakpoint
CREATE TABLE `__new_daily_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`query_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_daily_usage`("id", "user_id", "date", "query_count", "created_at", "input_tokens", "output_tokens") SELECT "id", "user_id", "date", "query_count", "created_at", "input_tokens", "output_tokens" FROM `daily_usage`;--> statement-breakpoint
-- Hand-added: keep the AUTOINCREMENT high-water mark (the copy alone resets it to max(id), so deleted ids
-- could be reused). Keep whichever of the old/new sequence rows is higher; DROP/RENAME below carry it over.
DELETE FROM sqlite_sequence WHERE name = '__new_daily_usage' AND seq <= (SELECT seq FROM sqlite_sequence WHERE name = 'daily_usage');--> statement-breakpoint
UPDATE sqlite_sequence SET name = '__new_daily_usage' WHERE name = 'daily_usage' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '__new_daily_usage');--> statement-breakpoint
DROP TABLE `daily_usage`;--> statement-breakpoint
ALTER TABLE `__new_daily_usage` RENAME TO `daily_usage`;--> statement-breakpoint
CREATE INDEX `idx_daily_usage_user_date` ON `daily_usage` (`user_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_usage_user_id_date_unique` ON `daily_usage` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `__new_rate_limits` (
	`role` text PRIMARY KEY NOT NULL,
	`daily_limit` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "rate_limits_role_check" CHECK(role IN ('user', 'admin'))
);
--> statement-breakpoint
INSERT INTO `__new_rate_limits`("role", "daily_limit", "updated_at") SELECT "role", "daily_limit", "updated_at" FROM `rate_limits`;--> statement-breakpoint
DROP TABLE `rate_limits`;--> statement-breakpoint
ALTER TABLE `__new_rate_limits` RENAME TO `rate_limits`;--> statement-breakpoint
CREATE TABLE `__new_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`month` text NOT NULL,
	`operation` text DEFAULT 'chat' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`input_cost_per_mtok_microusd` integer NOT NULL,
	`output_cost_per_mtok_microusd` integer NOT NULL,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	`session_id` text,
	`message_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "usage_events_operation_check" CHECK(operation = 'chat')
);
--> statement-breakpoint
INSERT INTO `__new_usage_events`("id", "user_id", "date", "month", "operation", "provider", "model", "input_tokens", "output_tokens", "input_cost_per_mtok_microusd", "output_cost_per_mtok_microusd", "cost_microusd", "session_id", "message_id", "created_at") SELECT "id", "user_id", "date", "month", "operation", "provider", "model", "input_tokens", "output_tokens", "input_cost_per_mtok_microusd", "output_cost_per_mtok_microusd", "cost_microusd", "session_id", "message_id", "created_at" FROM `usage_events`;--> statement-breakpoint
DROP TABLE `usage_events`;--> statement-breakpoint
ALTER TABLE `__new_usage_events` RENAME TO `usage_events`;--> statement-breakpoint
CREATE INDEX `idx_usage_events_user_date` ON `usage_events` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_user_month` ON `usage_events` (`user_id`,`month`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_message_id` ON `usage_events` (`message_id`);