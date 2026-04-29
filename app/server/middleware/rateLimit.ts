/**
 * Rate Limiting Middleware
 * Checks daily query usage and daily/monthly dollar budgets before each request.
 *
 * Priority order for limits:
 *   1. Per-user override (users.daily_query_limit / users.*_cost_limit_microusd)
 *   2. Role-based default from rate_limits table (query count)
 *   3. App config default (dollar budget)
 *
 * Enforcement semantics:
 *   - Query count  = STRICT  — atomic upsert, no race window.
 *   - Cost budget  = BEST-EFFORT — cost is unknown until the response
 *     completes, so spend is checked against *prior* requests. A single
 *     request can overshoot by at most its own model cost before the
 *     *next* request is blocked. This is standard behaviour for streaming
 *     APIs and is clearly documented here.
 *
 * Must run AFTER clerkAuth + requireDbUser (needs userId, role, dbUser on context).
 */

import type { Context, Next } from "hono";
import { dailyUsageQueries, rateLimitQueries, usageEventQueries } from "../db";
import { appConfig } from "../config";
import { logger } from "../logger";
import type { AppEnv } from "../types";
import {
  calculateChatCost,
  defaultCostLimitMicrousd,
  getNextUtcMidnight,
  getNextUtcMonthStart,
} from "../usage";

/**
 * Rate limiting middleware for the chat endpoint.
 * Sets X-RateLimit-* headers on every response.
 * Returns 429 when either the daily query limit or cost budget is exceeded.
 */
export async function rateLimitMiddleware(c: Context<AppEnv>, next: Next) {
  const userId = c.get("userId") as string;
  const role = c.get("role") as string;
  const dbUser = c.get("dbUser")!;

  const resetAt = getNextUtcMidnight();
  const monthlyResetAt = getNextUtcMonthStart();
  const todayFull = dailyUsageQueries.getTodayFull(userId);

  // ── 1. Query count — STRICT enforcement ──────────────────────────────────
  // Priority: user override > role-based default (-1 = unlimited)
  const queryLimit = dbUser.daily_query_limit ?? rateLimitQueries.getForRole(role);

  if (queryLimit !== -1 && todayFull.query_count >= queryLimit) {
    logger.warn("AUTH", "query_limit_exceeded", {
      ctx: { user_id: userId },
      data: { current: todayFull.query_count, limit: queryLimit, role },
    });

    c.header("X-RateLimit-Limit", String(queryLimit));
    c.header("X-RateLimit-Remaining", "0");
    c.header("X-RateLimit-Reset", String(resetAt));

    return c.json(
      {
        error: "query_limit_exceeded",
        message: `You have used all ${queryLimit} queries for today. Limits reset at midnight UTC.`,
        limit: queryLimit,
        used: todayFull.query_count,
        resetAt,
      },
      429
    );
  }

  // ── 2. Dollar budget — BEST-EFFORT enforcement ───────────────────────────
  // Pricing must exist for the active chat model before we spend provider API.
  try {
    calculateChatCost({
      provider: appConfig.llm.provider,
      model: appConfig.llm.chat_model,
      inputTokens: 0,
      outputTokens: 0,
    });
  } catch (error) {
    logger.error("AUTH", "pricing_not_configured", {
      ctx: { user_id: userId },
      error: error instanceof Error ? error : String(error),
    });

    return c.json(
      {
        error: "pricing_not_configured",
        message: "Usage pricing is not configured for the active chat model.",
      },
      500
    );
  }

  const isAdmin = role === "admin";
  const dailyCostLimit =
    dbUser.daily_cost_limit_microusd ??
    defaultCostLimitMicrousd(appConfig.usage.default_daily_cost_limit_usd, isAdmin);
  const monthlyCostLimit =
    dbUser.monthly_cost_limit_microusd ??
    defaultCostLimitMicrousd(appConfig.usage.default_monthly_cost_limit_usd, isAdmin);
  const todayCost = usageEventQueries.getTotalsForDate(userId).cost_microusd;
  const monthCost = usageEventQueries.getTotalsForMonth(userId).cost_microusd;

  if (dailyCostLimit !== -1 && todayCost >= dailyCostLimit) {
    logger.warn("AUTH", "daily_cost_limit_exceeded", {
      ctx: { user_id: userId },
      data: { cost_used_microusd: todayCost, limit_microusd: dailyCostLimit, role },
    });

    c.header("X-RateLimit-Cost-Daily-Limit", String(dailyCostLimit));
    c.header("X-RateLimit-Cost-Daily-Remaining", "0");
    c.header("X-RateLimit-Cost-Daily-Used", String(todayCost));
    c.header("X-RateLimit-Reset", String(resetAt));

    return c.json(
      {
        error: "cost_limit_exceeded",
        scope: "daily",
        message: "You have used your daily dollar budget. Limits reset at midnight UTC.",
        cost_limit_microusd: dailyCostLimit,
        cost_used_microusd: todayCost,
        resetAt,
      },
      429
    );
  }

  if (monthlyCostLimit !== -1 && monthCost >= monthlyCostLimit) {
    logger.warn("AUTH", "monthly_cost_limit_exceeded", {
      ctx: { user_id: userId },
      data: { cost_used_microusd: monthCost, limit_microusd: monthlyCostLimit, role },
    });

    c.header("X-RateLimit-Cost-Monthly-Limit", String(monthlyCostLimit));
    c.header("X-RateLimit-Cost-Monthly-Remaining", "0");
    c.header("X-RateLimit-Cost-Monthly-Used", String(monthCost));
    c.header("X-RateLimit-Monthly-Reset", String(monthlyResetAt));

    return c.json(
      {
        error: "cost_limit_exceeded",
        scope: "monthly",
        message: "You have used your monthly dollar budget. Limits reset next month.",
        cost_limit_microusd: monthlyCostLimit,
        cost_used_microusd: monthCost,
        resetAt: monthlyResetAt,
      },
      429
    );
  }

  // Tokens are still tracked for observability, but dollars are the launch gate.
  const tokenLimit: number =
    dbUser.daily_token_limit ??
    (role === "admin" ? -1 : appConfig.rate_limits.default_daily_tokens);

  const todayTokens = todayFull.input_tokens + todayFull.output_tokens;

  // ── Increment query count atomically before processing ───────────────────
  // Token increment happens inside processChat after the response completes.
  const newCount = dailyUsageQueries.incrementAndGet(userId);

  // Set rate limit headers with post-increment values
  c.header("X-RateLimit-Limit", String(queryLimit));
  c.header(
    "X-RateLimit-Remaining",
    String(queryLimit === -1 ? 999999 : Math.max(0, queryLimit - newCount))
  );
  c.header("X-RateLimit-Reset", String(resetAt));
  c.header("X-RateLimit-Token-Limit", String(tokenLimit));
  c.header(
    "X-RateLimit-Token-Remaining",
    String(tokenLimit === -1 ? 999999 : Math.max(0, tokenLimit - todayTokens))
  );
  c.header("X-RateLimit-Token-Used", String(todayTokens));
  c.header("X-RateLimit-Cost-Daily-Limit", String(dailyCostLimit));
  c.header(
    "X-RateLimit-Cost-Daily-Remaining",
    String(dailyCostLimit === -1 ? 999999 : Math.max(0, dailyCostLimit - todayCost))
  );
  c.header("X-RateLimit-Cost-Daily-Used", String(todayCost));
  c.header("X-RateLimit-Cost-Monthly-Limit", String(monthlyCostLimit));
  c.header(
    "X-RateLimit-Cost-Monthly-Remaining",
    String(monthlyCostLimit === -1 ? 999999 : Math.max(0, monthlyCostLimit - monthCost))
  );
  c.header("X-RateLimit-Cost-Monthly-Used", String(monthCost));
  c.header("X-RateLimit-Monthly-Reset", String(monthlyResetAt));

  await next();
}
