/**
 * artifacts (rules in ./users.ts): large tool outputs read back by inspect_artifact.
 */
import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chatSessions } from "./chat";

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(), // art_xxxxxxxx
    session_id: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    tool_name: text("tool_name").notNull(),
    // Tool arguments, so an expired artifact can tell the model how to refetch it.
    tool_input_json: text("tool_input_json").notNull(),
    // Noise-reduced JSON, gzipped (Bun.gzipSync).
    data: blob("data", { mode: "buffer" }).notNull(),
    raw_size_chars: integer("raw_size_chars").notNull(), // before noise reduction
    stored_size_chars: integer("stored_size_chars").notNull(), // after noise reduction, before gzip
    created_at: integer("created_at").notNull(), // unix seconds
    expires_at: integer("expires_at").notNull(), // unix seconds, measured from created_at
  },
  (t) => [
    index("idx_artifacts_session_id").on(t.session_id, t.created_at),
    index("idx_artifacts_expires_at").on(t.expires_at),
  ],
);
