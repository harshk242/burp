/**
 * Rate Limiting Middleware
 * Checks daily query usage against per-role configurable limits.
 * Must run AFTER clerkAuth + requireDbUser (needs userId, role on context).
 */

import type { Context, Next } from "hono";
import { dailyUsageQueries, rateLimitQueries } from "../db";
import { logger } from "../logger";

/**
 * Calculate the Unix timestamp of the next midnight UTC.
 */
function getResetTimestamp(): number {
  const now = new Date();
  const resetDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return Math.floor(resetDate.getTime() / 1000);
}

/**
 * Rate limiting middleware for the chat endpoint.
 * Sets X-RateLimit-* headers on every response.
 * Returns 429 when the daily limit is exceeded.
 */
export async function rateLimitMiddleware(c: Context, next: Next) {
  const userId = c.get("userId") as string;
  const role = c.get("role") as string;

  const dailyLimit = rateLimitQueries.getForRole(role);
  const currentUsage = dailyUsageQueries.getToday(userId);
  const resetAt = getResetTimestamp();

  // -1 means unlimited (admin)
  if (dailyLimit !== -1 && currentUsage >= dailyLimit) {
    logger.warn("AUTH", "rate_limit_exceeded", {
      ctx: { user_id: userId },
      data: { current: currentUsage, limit: dailyLimit, role },
    });

    c.header("X-RateLimit-Limit", String(dailyLimit));
    c.header("X-RateLimit-Remaining", "0");
    c.header("X-RateLimit-Reset", String(resetAt));

    return c.json(
      {
        error: "Rate limit exceeded",
        message: `You have used all ${dailyLimit} queries for today. Limits reset at midnight UTC.`,
        limit: dailyLimit,
        used: currentUsage,
        resetAt,
      },
      429
    );
  }

  // Increment usage synchronously before processing — no await between
  // the check above and this increment, so no race window.
  const newCount = dailyUsageQueries.incrementAndGet(userId);

  // Set rate limit headers with post-increment values
  c.header("X-RateLimit-Limit", String(dailyLimit));
  c.header(
    "X-RateLimit-Remaining",
    String(dailyLimit === -1 ? 999999 : Math.max(0, dailyLimit - newCount))
  );
  c.header("X-RateLimit-Reset", String(resetAt));

  await next();
}
