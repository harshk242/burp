ALTER TABLE `chat_turns` ADD `final_finish_reason` text;--> statement-breakpoint
ALTER TABLE `chat_turns` ADD `tool_error_count` integer DEFAULT 0 NOT NULL;