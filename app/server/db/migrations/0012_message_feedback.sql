CREATE TABLE `message_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`value` integer,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`sync_pending` integer DEFAULT 1 NOT NULL,
	`synced_revision` integer,
	`synced_at` integer,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_feedback_value_check" CHECK(value IN (0, 1)),
	CONSTRAINT "message_feedback_sync_pending_check" CHECK(sync_pending IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_message_feedback_message_user` ON `message_feedback` (`message_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_message_feedback_sync_pending` ON `message_feedback` (`sync_pending`);