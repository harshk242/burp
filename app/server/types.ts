import type { accessRequests, chatSessions, messages, usageEvents, users } from "./db/schema";

// ============================================
// DB row types, inferred from the Drizzle schema.
// The Zod schemas in ./schemas remain the API contract; __tests__/db-row-types.typecheck.ts
// asserts the two stay compatible (checked by `bun run typecheck`).
// ============================================

export type DbUser = typeof users.$inferSelect;
export type DbAccessRequest = typeof accessRequests.$inferSelect;
export type DbChatSession = typeof chatSessions.$inferSelect;
export type DbUsageEvent = typeof usageEvents.$inferSelect;

/**
 * Raw message row as stored in SQLite.
 * tool_calls is serialized JSON in the DB; the parsed form lives in MessageSchema2.
 */
export type DbMessageRow = typeof messages.$inferSelect;

// ============================================
// Hono AppEnv — declares all context variables set by middleware
// ============================================

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
