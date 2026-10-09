/**
 * Daily usage queries (rate limiting). One row per user per UTC day.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { dailyUsage } from "../schema";

const utcToday = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

export function createDailyUsageQueries(db: DrizzleDb) {
  const todayRow = (userId: string) => and(eq(dailyUsage.user_id, userId), eq(dailyUsage.date, utcToday()));

  return {
    /** Increment today's usage and return new count (single upsert). */
    incrementAndGet(userId: string): number {
      const row = db
        .insert(dailyUsage)
        .values({ user_id: userId, date: utcToday(), query_count: 1 })
        .onConflictDoUpdate({
          target: [dailyUsage.user_id, dailyUsage.date],
          set: { query_count: sql`${dailyUsage.query_count} + 1` },
        })
        .returning({ query_count: dailyUsage.query_count })
        .get();
      return row.query_count;
    },

    /** Get today's query count without incrementing */
    getToday(userId: string): number {
      const row = db.select({ query_count: dailyUsage.query_count }).from(dailyUsage).where(todayRow(userId)).get();
      return row?.query_count ?? 0;
    },

    /** Get today's full usage row: query count + token totals */
    getTodayFull(userId: string): { query_count: number; input_tokens: number; output_tokens: number } {
      const row = db
        .select({
          query_count: dailyUsage.query_count,
          input_tokens: dailyUsage.input_tokens,
          output_tokens: dailyUsage.output_tokens,
        })
        .from(dailyUsage)
        .where(todayRow(userId))
        .get();
      return row ?? { query_count: 0, input_tokens: 0, output_tokens: 0 };
    },

    /**
     * Add token counts for today's usage row (best-effort, called post-response).
     * Token enforcement is checked pre-request via getTodayFull; incremented here
     * after the response completes — up to 1 request of overshoot is possible.
     */
    incrementTokens(userId: string, inputTokens: number, outputTokens: number): void {
      db.insert(dailyUsage)
        .values({
          user_id: userId,
          date: utcToday(),
          query_count: 0,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        })
        .onConflictDoUpdate({
          target: [dailyUsage.user_id, dailyUsage.date],
          set: {
            input_tokens: sql`${dailyUsage.input_tokens} + excluded.input_tokens`,
            output_tokens: sql`${dailyUsage.output_tokens} + excluded.output_tokens`,
          },
        })
        .run();
    },
  };
}
