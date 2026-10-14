import { and, eq, lte, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { artifacts } from "../schema";

export type DbArtifact = typeof artifacts.$inferSelect;
export type NewDbArtifact = typeof artifacts.$inferInsert;

export function createArtifactQueries(db: DrizzleDb) {
  return {
    insert(row: NewDbArtifact) {
      return db.insert(artifacts).values(row).run();
    },

    findForSession(id: string, sessionId: string): DbArtifact | null {
      return (
        db
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, id), eq(artifacts.session_id, sessionId)))
          .get() ?? null
      );
    },

    deleteExpired(nowSec: number): number {
      return db
        .delete(artifacts)
        .where(lte(artifacts.expires_at, nowSec))
        .returning({ id: artifacts.id })
        .all().length;
    },

    evictOverBudget(sessionId: string, maxChars: number, keepId: string): string[] {
      return db
        .delete(artifacts)
        .where(
          sql`${artifacts.id} IN (
            SELECT id FROM (
              SELECT id, SUM(stored_size_chars) OVER (
                ORDER BY created_at DESC, rowid DESC
              ) AS newer_total
              FROM artifacts
              WHERE session_id = ${sessionId}
            )
            WHERE newer_total > ${maxChars} AND id != ${keepId}
          )`,
        )
        .returning({ id: artifacts.id })
        .all()
        .map((r) => r.id);
    },
  };
}
