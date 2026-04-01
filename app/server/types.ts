import { z } from "@hono/zod-openapi";
import {
  UserSchema,
  AccessRequestSchema,
  ChatSessionSchema,
  MessageSchema2,
} from "./schemas";

// ============================================
// DB row types derived from Zod schemas
// ============================================

export type DbUser = z.infer<typeof UserSchema>;
export type DbAccessRequest = z.infer<typeof AccessRequestSchema>;
export type DbChatSession = z.infer<typeof ChatSessionSchema>;

/**
 * Raw message row as stored in SQLite.
 * tool_calls is serialized JSON in the DB; the parsed form lives in MessageSchema2.
 */
export type DbMessageRow = Omit<z.infer<typeof MessageSchema2>, "tool_calls"> & {
  tool_calls: string | null;
};

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
