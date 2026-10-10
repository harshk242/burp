CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_input_json` text NOT NULL,
	`data` blob NOT NULL,
	`raw_size_chars` integer NOT NULL,
	`stored_size_chars` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_session_id` ON `artifacts` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_expires_at` ON `artifacts` (`expires_at`);