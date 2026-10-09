/**
 * Main chat usage cost ledger queries.
 */
import { and, count, eq, sql, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { usageEvents } from "../schema";
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
    create(event: Omit<DbUsageEvent, "created_at">): void {
      db.insert(usageEvents).values(event).run();
    },

    getTotalsForDate(userId: string, date = new Date().toISOString().slice(0, 10)): UsageTotals {
      return totals(and(eq(usageEvents.user_id, userId), eq(usageEvents.date, date)));
    },

    getTotalsForMonth(userId: string, month = new Date().toISOString().slice(0, 7)): UsageTotals {
      return totals(and(eq(usageEvents.user_id, userId), eq(usageEvents.month, month)));
    },
  };
}
