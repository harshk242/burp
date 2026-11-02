ALTER TABLE `artifacts` ADD `artifact_type` text DEFAULT 'json' NOT NULL;--> statement-breakpoint
ALTER TABLE `artifacts` ADD `stored_size_bytes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Gzip ISIZE is the uncompressed UTF-8 payload length, stored as a little-endian uint32.
UPDATE artifacts SET stored_size_bytes =
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 1, 1)) - 1) * 16 +
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 2, 1)) - 1) * 1 +
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 3, 1)) - 1) * 4096 +
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 4, 1)) - 1) * 256 +
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 5, 1)) - 1) * 1048576 +
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 6, 1)) - 1) * 65536 +
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 7, 1)) - 1) * 268435456 +
  (instr('0123456789ABCDEF', substr(hex(substr(data, -4)), 8, 1)) - 1) * 16777216;
