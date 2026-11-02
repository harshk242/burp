import type { UsageResponse } from "../../shared/usage";
import { UNLIMITED } from "../../shared/limits";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { UsageSchema, ErrorSchema } from "../schemas";
import { clerkAuth, requireDbUser, requireUser } from "../middleware/clerk";
import { dailyUsageQueries, rateLimitQueries, usageEventQueries } from "../db";
import type { AppEnv } from "../types";
import {
  getNextUtcMidnight,
  getNextUtcMonthStart,
  getRemainingMicrousd,
  resolveEffectiveLimits,
} from "../usage";

const usage = new OpenAPIHono<AppEnv>();

usage.use("*", clerkAuth, requireDbUser, requireUser);

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
  const dbUser = c.get("dbUser")!;

  const limits = resolveEffectiveLimits(dbUser, role, rateLimitQueries.getForRole(role));
  const dailyLimit = limits.daily_query_limit;
  const todayFull = dailyUsageQueries.getTodayFull(userId);

  const resetAt = getNextUtcMidnight();
  const monthlyResetAt = getNextUtcMonthStart();

  const remaining = dailyLimit === UNLIMITED ? UNLIMITED : Math.max(0, dailyLimit - todayFull.query_count);

  const tokenLimit = limits.daily_token_limit;
  const tokensUsedToday = todayFull.input_tokens + todayFull.output_tokens;
  const tokensRemaining = tokenLimit === UNLIMITED ? UNLIMITED : Math.max(0, tokenLimit - tokensUsedToday);
  const dailyCostLimit = limits.daily_cost_limit_microusd;
  const monthlyCostLimit = limits.monthly_cost_limit_microusd;
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
    } satisfies UsageResponse,
    200
  );
});

export { usage };
