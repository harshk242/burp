import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { UsageSchema, ErrorSchema } from "../schemas";
import { clerkAuth, requireDbUser, requireUser } from "../middleware/clerk";
import { dailyUsageQueries, rateLimitQueries } from "../db";
import { appConfig } from "../config";
import type { AppEnv } from "../types";

const usage = new OpenAPIHono<AppEnv>();

// Apply auth middleware
usage.use("*", clerkAuth, requireDbUser, requireUser);

// ============================================
// GET /api/usage - Current user's usage and limits
// ============================================

const getUsageRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Users"],
  summary: "Get current usage and rate limits",
  description: `Returns the current user's daily query usage, their role-based limit,
remaining queries, and the UTC midnight reset timestamp.
A limit of -1 means unlimited (admin users).`,
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Current usage and limits",
      content: {
        "application/json": {
          schema: UsageSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

usage.openapi(getUsageRoute, async (c) => {
  const userId = c.get("userId") as string;
  const role = c.get("role") as string;
  const dbUser = c.get("dbUser")!; // non-null: requireDbUser runs before this handler

  const dailyLimit = dbUser.daily_query_limit ?? rateLimitQueries.getForRole(role);
  const todayFull = dailyUsageQueries.getTodayFull(userId);

  // Next midnight UTC
  const now = new Date();
  const resetDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  const resetAt = Math.floor(resetDate.getTime() / 1000);

  const remaining = dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - todayFull.query_count);

  // Token budget
  const tokenLimit: number =
    dbUser.daily_token_limit ??
    (role === "admin" ? -1 : appConfig.rate_limits.default_daily_tokens);
  const tokensUsedToday = todayFull.input_tokens + todayFull.output_tokens;
  const tokensRemaining = tokenLimit === -1 ? -1 : Math.max(0, tokenLimit - tokensUsedToday);

  return c.json(
    {
      used: todayFull.query_count,
      limit: dailyLimit,
      remaining,
      resetAt,
      total_queries: dbUser.total_queries,
      role: role as "waitlist" | "user" | "admin",
      tokens: {
        used_today: tokensUsedToday,
        limit: tokenLimit,
        remaining: tokensRemaining,
        input_today: todayFull.input_tokens,
        output_today: todayFull.output_tokens,
      },
    },
    200
  );
});

export { usage };
