import type { accessRequests, chatSessions, messages, usageEvents, users } from "./db/schema";

export type DbUser = typeof users.$inferSelect;
export type DbAccessRequest = typeof accessRequests.$inferSelect;
export type DbChatSession = typeof chatSessions.$inferSelect;
export type DbUsageEvent = typeof usageEvents.$inferSelect;

export type DbMessageRow = typeof messages.$inferSelect;

export type AppEnv = {
  Variables: {
    requestId: string;
    clerkUserId: string;
    userId: string | null;
    email: string;
    role: string;
    dbUser: DbUser | null;
    clerkName: string | null;
    clerkImageUrl: string | null;
  };
};
