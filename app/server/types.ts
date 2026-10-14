import type { accessRequests, chatSessions, messages, usageEvents, users } from "./db/schema";

export type DbUser = typeof users.$inferSelect;
export type DbAccessRequest = typeof accessRequests.$inferSelect;
export type DbChatSession = typeof chatSessions.$inferSelect;
export type DbUsageEvent = typeof usageEvents.$inferSelect;

/**
 * Raw message row as stored in SQLite.
 * tool_calls is serialized JSON in the DB; the parsed form lives in MessageSchema2.
 */
export type DbMessageRow = typeof messages.$inferSelect;

export type AppEnv = {
  Variables: {
    requestId: string;
    clerkUserId: string;
    /** null for unauthenticated users; routes behind requireDbUser can safely narrow with `as string` */
    userId: string | null;
    email: string;
    role: string;
    dbUser: DbUser | null;
    clerkName: string | null;
    clerkImageUrl: string | null;
  };
};
