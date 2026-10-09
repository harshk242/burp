import { desc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { chatSessions } from "../schema";
import type { DbChatSession } from "../../types";

export function createChatSessionQueries(db: DrizzleDb) {
  return {
    create(id: string, userId: string, title: string | null) {
      return db
        .insert(chatSessions)
        .values({ id, user_id: userId, title, updated_at: sql`(unixepoch())` })
        .run();
    },

    findByUserId(userId: string): DbChatSession[] {
      return db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.user_id, userId))
        .orderBy(desc(chatSessions.updated_at))
        .all();
    },

    findById(id: string): DbChatSession | null {
      return db.select().from(chatSessions).where(eq(chatSessions.id, id)).get() ?? null;
    },

    updateTitle(id: string, title: string) {
      return db
        .update(chatSessions)
        .set({ title, updated_at: sql`(unixepoch())` })
        .where(eq(chatSessions.id, id))
        .run();
    },

    touch(id: string) {
      return db.update(chatSessions).set({ updated_at: sql`(unixepoch())` }).where(eq(chatSessions.id, id)).run();
    },

    delete(id: string) {
      return db.delete(chatSessions).where(eq(chatSessions.id, id)).run();
    },
  };
}
