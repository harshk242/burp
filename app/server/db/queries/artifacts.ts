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

    /** Delete rows past expires_at (unix seconds); returns the number removed. */
    deleteExpired(nowSec: number): number {
      return db
        .delete(artifacts)
        .where(lte(artifacts.expires_at, nowSec))
        .returning({ id: artifacts.id })
        .all().length;
    },

    /**
     * Enforce a per-session size budget: delete the oldest rows (by created_at,
     * then insertion order) until the session's total stored_size_chars is within
     * maxChars. Keeps the newest rows whose running total, counted newest-first,
     * fits; `keepId` is never deleted even if it alone exceeds the budget.
     * Returns the deleted IDs.
     */
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
