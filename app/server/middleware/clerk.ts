/**
 * Clerk Authentication Middleware for Hono
 * Verifies JWT tokens from Clerk
 *
 * Will be fully implemented in Phase 2 (Auth)
 */

import type { Context, Next } from "hono";

// Cache user info to avoid repeated API calls
const userCache = new Map<string, { email: string; expiresAt: number }>();

/**
 * Clerk JWT verification middleware
 * Placeholder - full implementation in Phase 2
 */
export async function clerkAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  // Skip auth for development if no Clerk keys configured
  if (!process.env.CLERK_SECRET_KEY) {
    // Development mode - set test user
    c.set("userId", "dev-user-id");
    c.set("email", "dev@example.com");
    c.set("role", "admin");
    return next();
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // TODO: Phase 2 implementation
  // 1. Verify JWT with Clerk
  // 2. Extract user info
  // 3. Check/sync user in database
  // 4. Set context variables

  return c.json({ error: "Auth not implemented" }, 501);
}

/**
 * Role-based access control middleware
 */
export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const userRole = c.get("role");

    if (!userRole || !roles.includes(userRole)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return next();
  };
}

/**
 * Admin-only middleware
 */
export const requireAdmin = requireRole("admin");

/**
 * User or admin middleware
 */
export const requireUser = requireRole("user", "admin");
