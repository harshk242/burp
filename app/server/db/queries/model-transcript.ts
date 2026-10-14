import { asc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { modelTranscript } from "../schema";

export type DbTranscriptRow = typeof modelTranscript.$inferSelect;
export type TranscriptRole = DbTranscriptRow["role"];

export interface NewTranscriptRow {
  turnId: string;
  role: TranscriptRole;
  contentJson: string;
  provider: string;
  model: string;
  contextVersion: string;
  toolNamesJson: string;
}

export function createModelTranscriptQueries(db: DrizzleDb) {
  return {
    /**
     * Appends rows after the session's last `seq`, in order, in one
     * transaction. Returns the seq values assigned.
     */
    append(sessionId: string, rows: NewTranscriptRow[]): number[] {
      if (rows.length === 0) return [];
      return db.transaction((tx) => {
        const last = tx
          .select({ seq: sql<number | null>`max(${modelTranscript.seq})` })
          .from(modelTranscript)
          .where(eq(modelTranscript.session_id, sessionId))
          .get();
        const first = (last?.seq ?? -1) + 1;
        tx.insert(modelTranscript)
          .values(
            rows.map((row, i) => ({
              session_id: sessionId,
              seq: first + i,
              turn_id: row.turnId,
              role: row.role,
              content_json: row.contentJson,
              provider: row.provider,
              model: row.model,
              context_version: row.contextVersion,
              tool_names_json: row.toolNamesJson,
            })),
          )
          .run();
        return rows.map((_, i) => first + i);
      });
    },

    findBySessionId(sessionId: string): DbTranscriptRow[] {
      return db
        .select()
        .from(modelTranscript)
        .where(eq(modelTranscript.session_id, sessionId))
        .orderBy(asc(modelTranscript.seq))
        .all();
    },
  };
}
