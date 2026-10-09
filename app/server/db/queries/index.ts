/**
 * Query objects, one file each. Every factory takes the Drizzle instance so
 * tests can bind them to createTestDb(); db/index.ts binds them to the app DB.
 */
import type { DrizzleDb } from "../connection";
import { createAccessRequestQueries } from "./access-requests";
import { createChatSessionQueries } from "./chat-sessions";
import { createDailyUsageQueries } from "./daily-usage";
import { createMessageQueries } from "./messages";
import { createRateLimitQueries } from "./rate-limits";
import { createToolSearchQueries } from "./tool-search";
import { createUsageEventQueries } from "./usage-events";
import { createUserQueries } from "./users";

export type { ToolSearchRow } from "./tool-search";
export type { UsageTotals } from "./usage-events";

export function createQueries(db: DrizzleDb) {
  return {
    userQueries: createUserQueries(db),
    accessRequestQueries: createAccessRequestQueries(db),
    chatSessionQueries: createChatSessionQueries(db),
    messageQueries: createMessageQueries(db),
    dailyUsageQueries: createDailyUsageQueries(db),
    usageEventQueries: createUsageEventQueries(db),
    rateLimitQueries: createRateLimitQueries(db),
    toolSearchQueries: createToolSearchQueries(db),
  };
}

export type Queries = ReturnType<typeof createQueries>;
