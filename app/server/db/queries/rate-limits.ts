import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { rateLimits } from "../schema";

type RateLimitRole = typeof rateLimits.$inferSelect["role"];

export function createRateLimitQueries(db: DrizzleDb) {
  return {
    getForRole(role: string): number {
      const row = db
        .select({ daily_limit: rateLimits.daily_limit })
        .from(rateLimits)
        .where(eq(rateLimits.role, role as RateLimitRole))
        .get();
      if (!row) return role === "admin" ? -1 : 50;
      return row.daily_limit;
    },

    update(role: string, dailyLimit: number) {
      return db
        .insert(rateLimits)
        .values({ role: role as RateLimitRole, daily_limit: dailyLimit, updated_at: sql`(unixepoch())` })
        .onConflictDoUpdate({
          target: rateLimits.role,
          set: { daily_limit: dailyLimit, updated_at: sql`(unixepoch())` },
        })
        .run();
    },
  };
}
