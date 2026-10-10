import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { artifacts } from "../schema";

export type DbArtifact = typeof artifacts.$inferSelect;
export type NewDbArtifact = typeof artifacts.$inferInsert;

export function createArtifactQueries(db: DrizzleDb) {
  return {
    insert(row: NewDbArtifact) {
      return db.insert(artifacts).values(row).run();
    },

    /** Session-scoped lookup: another session's artifact reads as missing. */
    findForSession(id: string, sessionId: string): DbArtifact | null {
      return (
        db
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, id), eq(artifacts.session_id, sessionId)))
          .get() ?? null
      );
    },
  };
}
