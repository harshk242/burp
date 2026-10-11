-- Hand-edited: the UPDATE trigger is added by hand (drizzle-kit has no triggers). model_transcript is append-only:
-- replay parses rows as they are, so a changed row would break the prompt cache and thinking signatures.
CREATE TABLE `model_transcript` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`turn_id` text NOT NULL,
	`role` text NOT NULL,
	`content_json` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`context_version` text NOT NULL,
	`tool_names_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `chat_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "model_transcript_role_check" CHECK(role IN ('user', 'assistant', 'tool', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_model_transcript_session_seq` ON `model_transcript` (`session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_model_transcript_turn_id` ON `model_transcript` (`turn_id`);--> statement-breakpoint
CREATE TRIGGER `model_transcript_no_update` BEFORE UPDATE ON `model_transcript`
BEGIN
	SELECT RAISE(ABORT, 'model_transcript is append-only');
END;
