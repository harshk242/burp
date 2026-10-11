-- Hand-edited: drizzle-kit drops the FK actions from ALTER TABLE ADD; `ON DELETE set null` is added back so the
-- column matches the schema (usage rows outlive a deleted turn, like message_id).
CREATE TABLE `chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_message_id` text NOT NULL,
	`assistant_message_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`error_code` text,
	`error_message` text,
	`iterations` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chat_turns_status_check" CHECK(status IN ('running', 'ok', 'error', 'aborted'))
);
--> statement-breakpoint
CREATE INDEX `idx_chat_turns_session_id` ON `chat_turns` (`session_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `usage_events` ADD `turn_id` text REFERENCES chat_turns(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_usage_events_turn_id` ON `usage_events` (`turn_id`);