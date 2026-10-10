-- Hand-edited: the generated copy also selected `status` / `usage_estimated` from the old table, where they
-- don't exist yet; they are dropped from the INSERT so legacy rows take the defaults ('ok', 0).
-- Recreate is needed to add the CHECK constraints. The generated `PRAGMA foreign_keys` lines are no-ops inside
-- the migration transaction; runMigrations() turns FKs off before BEGIN so `DROP TABLE` doesn't cascade, and
-- runs foreign_key_check before COMMIT.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_5m_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_1h_tokens` integer DEFAULT 0 NOT NULL,
	`input_cost_per_mtok_microusd` integer NOT NULL,
	`output_cost_per_mtok_microusd` integer NOT NULL,
	`pricing_json` text,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	`input_cost_microusd` integer DEFAULT 0 NOT NULL,
	`cache_read_cost_microusd` integer DEFAULT 0 NOT NULL,
	`cache_write_cost_microusd` integer DEFAULT 0 NOT NULL,
	`output_cost_microusd` integer DEFAULT 0 NOT NULL,
	`llm_calls` integer,
	`long_context_calls` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`usage_estimated` integer DEFAULT 0 NOT NULL,
	`session_id` text,
	`message_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "usage_events_operation_check" CHECK(operation = 'chat'),
	CONSTRAINT "usage_events_status_check" CHECK(status IN ('ok', 'error')),
	CONSTRAINT "usage_events_usage_estimated_check" CHECK(usage_estimated IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_usage_events`("id", "user_id", "date", "month", "operation", "provider", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens", "input_cost_per_mtok_microusd", "output_cost_per_mtok_microusd", "pricing_json", "cost_microusd", "input_cost_microusd", "cache_read_cost_microusd", "cache_write_cost_microusd", "output_cost_microusd", "llm_calls", "long_context_calls", "session_id", "message_id", "created_at") SELECT "id", "user_id", "date", "month", "operation", "provider", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens", "input_cost_per_mtok_microusd", "output_cost_per_mtok_microusd", "pricing_json", "cost_microusd", "input_cost_microusd", "cache_read_cost_microusd", "cache_write_cost_microusd", "output_cost_microusd", "llm_calls", "long_context_calls", "session_id", "message_id", "created_at" FROM `usage_events`;--> statement-breakpoint
DROP TABLE `usage_events`;--> statement-breakpoint
ALTER TABLE `__new_usage_events` RENAME TO `usage_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_usage_events_user_date` ON `usage_events` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_user_month` ON `usage_events` (`user_id`,`month`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_message_id` ON `usage_events` (`message_id`);