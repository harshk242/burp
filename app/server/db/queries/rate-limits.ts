import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { rateLimits } from "../schema";

type RateLimitRole = typeof rateLimits.$inferSelect["role"];

const isRateLimitRole = (role: string): role is RateLimitRole => role === "user" || role === "admin";

export function createRateLimitQueries(db: DrizzleDb) {
  return {
    getForRole(role: string): number {
      if (!isRateLimitRole(role)) return 50;
      const row = db
        .select({ daily_limit: rateLimits.daily_limit })
        .from(rateLimits)
        .where(eq(rateLimits.role, role))
        .get();
      if (!row) return role === "admin" ? -1 : 50;
      return row.daily_limit;
    },

    update(role: RateLimitRole, dailyLimit: number) {
      return db
        .insert(rateLimits)
        .values({ role, daily_limit: dailyLimit, updated_at: sql`(unixepoch())` })
        .onConflictDoUpdate({
          target: rateLimits.role,
          set: { daily_limit: dailyLimit, updated_at: sql`(unixepoch())` },
        })
        .run();
    },
  };
}
