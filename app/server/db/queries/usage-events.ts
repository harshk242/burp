import { and, count, eq, sql, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { usageEvents } from "../schema";
import { createDailyUsageQueries } from "./daily-usage";
import type { UsageLedgerFields } from "../../orchestration/usage-meter";
import type { DbUsageEvent } from "../../types";

export interface UsageTotals {
  cost_microusd: number;
  input_tokens: number;
  output_tokens: number;
  query_count: number;
}

export function createUsageEventQueries(db: DrizzleDb) {
  function totals(where: SQL | undefined): UsageTotals {
    return db
      .select({
        cost_microusd: sql<number>`coalesce(sum(${usageEvents.cost_microusd}), 0)`,
        input_tokens: sql<number>`coalesce(sum(${usageEvents.input_tokens}), 0)`,
        output_tokens: sql<number>`coalesce(sum(${usageEvents.output_tokens}), 0)`,
        query_count: count(),
      })
      .from(usageEvents)
      .where(where)
      .get()!; // aggregate without GROUP BY always yields one row
  }

  return {
    exists(id: string): boolean {
      return !!db.select({ id: usageEvents.id }).from(usageEvents).where(eq(usageEvents.id, id)).get();
    },

    create(event: Omit<DbUsageEvent, "created_at" | "reconciliation_state"> & Partial<Pick<DbUsageEvent, "reconciliation_state">>): void {
      db.insert(usageEvents).values(event).run();
    },

    findPendingReconciliation(): DbUsageEvent[] {
      return db.select().from(usageEvents).where(sql`${usageEvents.reconciliation_state} != 'none'`).all();
    },

    reconcile(id: string, measured: UsageLedgerFields): boolean {
      return db.transaction(() => {
        const previous = db.select().from(usageEvents).where(eq(usageEvents.id, id)).get();
        if (!previous || previous.reconciliation_state === "none") return false;
        db.update(usageEvents).set({ ...measured, usage_estimated: 0, reconciliation_state: "none" })
          .where(eq(usageEvents.id, id)).run();
        createDailyUsageQueries(db).incrementTokens(previous.user_id,
          measured.input_tokens - previous.input_tokens, measured.output_tokens - previous.output_tokens, previous.date);
        return true;
      });
    },

    findByTurnId(turnId: string): DbUsageEvent[] {
      return db.select().from(usageEvents).where(eq(usageEvents.turn_id, turnId)).all() as DbUsageEvent[];
    },

    getTotalsForDate(userId: string, date = new Date().toISOString().slice(0, 10)): UsageTotals {
      return totals(and(eq(usageEvents.user_id, userId), eq(usageEvents.date, date)));
    },

    getTotalsForMonth(userId: string, month = new Date().toISOString().slice(0, 7)): UsageTotals {
      return totals(and(eq(usageEvents.user_id, userId), eq(usageEvents.month, month)));
    },
  };
}
