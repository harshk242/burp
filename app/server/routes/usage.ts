import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { UsageSchema, ErrorSchema } from "../schemas";
import { clerkAuth, requireDbUser, requireUser } from "../middleware/clerk";
import { dailyUsageQueries, rateLimitQueries, usageEventQueries } from "../db";
import { appConfig } from "../config";
import type { AppEnv } from "../types";
import {
  defaultCostLimitMicrousd,
  getNextUtcMidnight,
  getNextUtcMonthStart,
  getRemainingMicrousd,
} from "../usage";

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

  const resetAt = getNextUtcMidnight();
  const monthlyResetAt = getNextUtcMonthStart();

  const remaining = dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - todayFull.query_count);

  // Token budget
  const tokenLimit: number =
    dbUser.daily_token_limit ??
    (role === "admin" ? -1 : appConfig.rate_limits.default_daily_tokens);
  const tokensUsedToday = todayFull.input_tokens + todayFull.output_tokens;
  const tokensRemaining = tokenLimit === -1 ? -1 : Math.max(0, tokenLimit - tokensUsedToday);
  const isAdmin = role === "admin";
  const dailyCostLimit =
    dbUser.daily_cost_limit_microusd ??
    defaultCostLimitMicrousd(appConfig.usage.default_daily_cost_limit_usd, isAdmin);
  const monthlyCostLimit =
    dbUser.monthly_cost_limit_microusd ??
    defaultCostLimitMicrousd(appConfig.usage.default_monthly_cost_limit_usd, isAdmin);
  const todayCost = usageEventQueries.getTotalsForDate(userId).cost_microusd;
  const monthCost = usageEventQueries.getTotalsForMonth(userId).cost_microusd;

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
      cost: {
        daily_used_microusd: todayCost,
        daily_limit_microusd: dailyCostLimit,
        daily_remaining_microusd: getRemainingMicrousd(dailyCostLimit, todayCost),
        daily_reset_at: resetAt,
        monthly_used_microusd: monthCost,
        monthly_limit_microusd: monthlyCostLimit,
        monthly_remaining_microusd: getRemainingMicrousd(monthlyCostLimit, monthCost),
        monthly_reset_at: monthlyResetAt,
      },
    },
    200
  );
});

export { usage };
