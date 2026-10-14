import { desc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { users } from "../schema";
import type { DbUser } from "../../types";

export function createUserQueries(db: DrizzleDb) {
  return {
    findByClerkId(clerkId: string): DbUser | null {
      return db.select().from(users).where(eq(users.clerk_id, clerkId)).get() ?? null;
    },

    findByEmail(email: string): DbUser | null {
      return db.select().from(users).where(eq(users.email, email)).get() ?? null;
    },

    findById(id: string): DbUser | null {
      return db.select().from(users).where(eq(users.id, id)).get() ?? null;
    },

    create(
      id: string,
      clerkId: string,
      email: string,
      name: string | null,
      imageUrl: string | null,
      role: string,
      institution: string | null,
      researchArea: string | null
    ) {
      return db
        .insert(users)
        .values({
          id,
          clerk_id: clerkId,
          email,
          name,
          image_url: imageUrl,
          role: role as DbUser["role"],
          institution,
          research_area: researchArea,
        })
        .run();
    },

    updateLastActive(id: string) {
      return db.update(users).set({ last_active_at: sql`(unixepoch())` }).where(eq(users.id, id)).run();
    },

    incrementQueries(id: string) {
      return db
        .update(users)
        .set({ total_queries: sql`${users.total_queries} + 1` })
        .where(eq(users.id, id))
        .run();
    },

    updateRole(id: string, role: string) {
      return db
        .update(users)
        .set({ role: role as DbUser["role"] })
        .where(eq(users.id, id))
        .run();
    },

    updateLimits(
      id: string,
      dailyQueryLimit: number | null,
      dailyTokenLimit: number | null,
      dailyCostLimitMicrousd: number | null,
      monthlyCostLimitMicrousd: number | null
    ) {
      return db
        .update(users)
        .set({
          daily_query_limit: dailyQueryLimit,
          daily_token_limit: dailyTokenLimit,
          daily_cost_limit_microusd: dailyCostLimitMicrousd,
          monthly_cost_limit_microusd: monthlyCostLimitMicrousd,
        })
        .where(eq(users.id, id))
        .run();
    },

    listAll(): DbUser[] {
      return db.select().from(users).orderBy(desc(users.created_at)).all();
    },
  };
}
