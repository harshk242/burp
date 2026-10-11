ALTER TABLE `usage_events` ADD `cache_read_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `cache_write_5m_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `cache_write_1h_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `pricing_json` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `input_cost_microusd` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `cache_read_cost_microusd` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `cache_write_cost_microusd` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `output_cost_microusd` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `llm_calls` integer;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `long_context_calls` integer DEFAULT 0 NOT NULL;