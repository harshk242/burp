import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chatSessions } from "./chat";

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    tool_name: text("tool_name").notNull(),
    tool_input_json: text("tool_input_json").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    artifact_type: text("artifact_type", { enum: ["json", "text"] }).notNull().default("json"),
    stored_size_bytes: integer("stored_size_bytes").notNull().default(0),
    raw_size_chars: integer("raw_size_chars").notNull(),
    stored_size_chars: integer("stored_size_chars").notNull(),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (t) => [
    index("idx_artifacts_session_id").on(t.session_id, t.created_at),
    index("idx_artifacts_expires_at").on(t.expires_at),
  ],
);
