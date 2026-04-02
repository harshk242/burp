/**
 * Rate Limiting Middleware
 * Checks daily query usage AND daily token budget before processing each request.
 *
 * Priority order for limits:
 *   1. Per-user override (users.daily_query_limit / users.daily_token_limit)
 *   2. Role-based default from rate_limits table (query count)
 *   3. App config default (token budget)
 *
 * Enforcement semantics:
 *   - Query count  = STRICT  — atomic upsert, no race window.
 *   - Token budget = BEST-EFFORT — tokens are unknown until the response
 *     completes, so they are checked against *prior* requests. A single
 *     request can overshoot by at most its own token count before the
 *     *next* request is blocked. This is standard behaviour for streaming
 *     APIs and is clearly documented here.
 *
 * Must run AFTER clerkAuth + requireDbUser (needs userId, role, dbUser on context).
 */

import type { Context, Next } from "hono";
import { dailyUsageQueries, rateLimitQueries } from "../db";
import { appConfig } from "../config";
import { logger } from "../logger";
import type { AppEnv } from "../types";

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
 * Returns 429 when either the daily query limit or token budget is exceeded.
 */
export async function rateLimitMiddleware(c: Context<AppEnv>, next: Next) {
  const userId = c.get("userId") as string;
  const role = c.get("role") as string;
  const dbUser = c.get("dbUser")!;

  const resetAt = getResetTimestamp();
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

  // ── 2. Token budget — BEST-EFFORT enforcement ────────────────────────────
  // Tokens are unknown until the response completes, so we check accumulated
  // tokens from *prior* requests. The current request can overshoot by at most
  // its own token count before the *next* request is blocked.
  // Priority: user override > config default; admin always -1 (unlimited).
  const tokenLimit: number =
    dbUser.daily_token_limit ??
    (role === "admin" ? -1 : appConfig.rate_limits.default_daily_tokens);

  const todayTokens = todayFull.input_tokens + todayFull.output_tokens;

  if (tokenLimit !== -1 && todayTokens >= tokenLimit) {
    logger.warn("AUTH", "token_limit_exceeded", {
      ctx: { user_id: userId },
      data: { tokens_used: todayTokens, limit: tokenLimit, role },
    });

    c.header("X-RateLimit-Token-Limit", String(tokenLimit));
    c.header("X-RateLimit-Token-Remaining", "0");
    c.header("X-RateLimit-Token-Used", String(todayTokens));
    c.header("X-RateLimit-Reset", String(resetAt));

    return c.json(
      {
        error: "token_limit_exceeded",
        message: `You have used your daily token budget of ${tokenLimit.toLocaleString()} tokens. Limits reset at midnight UTC.`,
        token_limit: tokenLimit,
        tokens_used: todayTokens,
        resetAt,
      },
      429
    );
  }

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

  await next();
}
