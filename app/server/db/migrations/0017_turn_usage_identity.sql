ALTER TABLE `chat_turns` ADD `last_input_message_count` integer;--> statement-breakpoint
ALTER TABLE `chat_turns` ADD `last_input_identity` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `reconciliation_state` text DEFAULT 'none' NOT NULL;