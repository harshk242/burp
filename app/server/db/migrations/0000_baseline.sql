CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`research_area` text,
	`use_case` text,
	`status` text DEFAULT 'pending',
	`submitted_at` integer DEFAULT (unixepoch()),
	`reviewed_at` integer,
	`reviewed_by` text,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "access_requests_status_check" CHECK(status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_requests_email_unique` ON `access_requests` (`email`);--> statement-breakpoint
CREATE INDEX `idx_access_requests_email` ON `access_requests` (`email`);--> statement-breakpoint
CREATE INDEX `idx_access_requests_status` ON `access_requests` (`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`clerk_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`image_url` text,
	`role` text DEFAULT 'waitlist',
	`institution` text,
	`research_area` text,
	`total_queries` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()),
	`last_active_at` integer,
	`daily_query_limit` integer,
	`daily_token_limit` integer,
	`daily_cost_limit_microusd` integer,
	`monthly_cost_limit_microusd` integer,
	CONSTRAINT "users_role_check" CHECK(role IN ('waitlist', 'user', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_id_unique` ON `users` (`clerk_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_clerk_id` ON `users` (`clerk_id`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_user_id` ON `chat_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text,
	`tool_calls` text,
	`created_at` integer DEFAULT (unixepoch()),
	`input_tokens` integer DEFAULT 0,
	`output_tokens` integer DEFAULT 0,
	`reasoning` text,
	`cost_microusd` integer DEFAULT 0,
	FOREIGN KEY (`chat_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_role_check" CHECK(role IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE INDEX `idx_messages_chat_id` ON `messages` (`chat_id`);--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`query_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()),
	`input_tokens` integer DEFAULT 0,
	`output_tokens` integer DEFAULT 0,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_daily_usage_user_date` ON `daily_usage` (`user_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_usage_user_id_date_unique` ON `daily_usage` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`role` text PRIMARY KEY,
	`daily_limit` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()),
	CONSTRAINT "rate_limits_role_check" CHECK(role IN ('user', 'admin'))
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY,
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
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "usage_events_operation_check" CHECK(operation = 'chat')
);
--> statement-breakpoint
CREATE INDEX `idx_usage_events_user_date` ON `usage_events` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_user_month` ON `usage_events` (`user_id`,`month`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_message_id` ON `usage_events` (`message_id`);