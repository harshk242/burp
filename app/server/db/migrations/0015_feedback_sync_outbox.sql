CREATE TABLE `feedback_sync_operations` (
	`feedback_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`cleanup_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`feedback_id`, `revision`),
	CONSTRAINT `feedback_sync_operations_state_check` CHECK(state IN ('write_pending', 'accepted', 'retired', 'confirmation_pending', 'cleaned')),
	FOREIGN KEY (`feedback_id`) REFERENCES `message_feedback`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `sync_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `claim_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `retry_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` ADD `failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `message_feedback` DROP COLUMN `delete_unconfirmed`;
--> statement-breakpoint
INSERT INTO feedback_sync_operations (feedback_id, revision, state) SELECT id, 0, 'retired' FROM message_feedback;
--> statement-breakpoint
UPDATE message_feedback SET sync_pending = 1, sync_state = 'pending';
