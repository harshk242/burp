/**
 * Clerk Authentication Middleware for Hono
 * Verifies JWT tokens and manages user sessions
 */

import type { Context, Next } from "hono";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { userQueries, accessRequestQueries } from "../db";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import type { AppEnv, DbUser, DbAccessRequest } from "../types";

// Initialize Clerk client (lazy, only when needed)
let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient() {
  if (!clerkClient && process.env.CLERK_SECRET_KEY) {
    clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  }
  return clerkClient;
}

// Cache user info to avoid repeated Clerk API calls
const userCache = new Map<string, { email: string; name: string | null; imageUrl: string | null; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clerk JWT verification middleware
 * Sets userId, email, role, and dbUser on context
 */
export async function clerkAuth(c: Context<AppEnv>, next: Next) {
  const clerk = getClerkClient();

  // Development mode - skip auth if no Clerk keys configured
  if (!clerk) {
    logger.warn("AUTH", "dev_mode_no_clerk_key");
    const devClerkId = "dev-clerk-id";
    const devEmail = process.env.ADMIN_EMAIL || "dev@example.com";

    // Sync dev user to database (creates if not exists, makes them admin)
    let dbUser = userQueries.findByClerkId(devClerkId);
    if (!dbUser) {
      const userId = uuidv4();
      userQueries.create(userId, devClerkId, devEmail, "Dev User", null, "admin", null, null);
      dbUser = userQueries.findById(userId);
      if (!dbUser) {
        throw new Error(`[clerkAuth] Dev user create succeeded but findById(${userId}) returned null — possible DB write failure`);
      }
    }

    c.set("clerkUserId", devClerkId);
    c.set("userId", dbUser.id);
    c.set("email", dbUser.email);
    c.set("role", dbUser.role);
    c.set("dbUser", dbUser);
    c.set("clerkName", dbUser.name);
    c.set("clerkImageUrl", dbUser.image_url);
    return next();
  }

  // Extract Bearer token
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized - missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  if (!token) {
    return c.json({ error: "Unauthorized - empty token" }, 401);
  }

  try {
    // Verify JWT with Clerk
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! });
    const clerkUserId = payload.sub;

    if (!clerkUserId) {
      return c.json({ error: "Invalid token - missing subject" }, 401);
    }

    // Get user info from cache or Clerk API
    let userInfo = userCache.get(clerkUserId);

    if (!userInfo || userInfo.expiresAt < Date.now()) {
      // Fetch from Clerk API
      const clerkUser = await clerk.users.getUser(clerkUserId);
      const primaryEmail = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId);
      const email = primaryEmail?.emailAddress;

      if (!email) {
        return c.json({ error: "User has no email address" }, 401);
      }

      userInfo = {
        email,
        name: clerkUser.firstName && clerkUser.lastName
          ? `${clerkUser.firstName} ${clerkUser.lastName}`
          : clerkUser.firstName || clerkUser.lastName || null,
        imageUrl: clerkUser.imageUrl || null,
        expiresAt: Date.now() + CACHE_TTL,
      };
      userCache.set(clerkUserId, userInfo);
    }

    // Look up user in database
    const dbUser = userQueries.findByClerkId(clerkUserId);

    // Set context variables
    c.set("clerkUserId", clerkUserId);
    c.set("email", userInfo.email);
    c.set("clerkName", userInfo.name);
    c.set("clerkImageUrl", userInfo.imageUrl);

    if (dbUser) {
      c.set("userId", dbUser.id);
      c.set("role", dbUser.role);
      c.set("dbUser", dbUser);

      // Update last active timestamp (fire and forget)
      try {
        userQueries.updateLastActive(dbUser.id);
      } catch {
        // Ignore errors
      }
    } else {
      // User not in database yet - set minimal context
      c.set("userId", null);
      c.set("role", "unknown");
      c.set("dbUser", null);
    }

    return next();
  } catch (err) {
    const isExpired = err instanceof Error && err.message.includes("expired");
    logger.warn("AUTH", isExpired ? "token_expired" : "token_invalid", {
      error: err instanceof Error ? err : String(err),
    });

    if (isExpired) {
      return c.json({ error: "Token expired" }, 401);
    }

    return c.json({ error: "Invalid token" }, 401);
  }
}

/**
 * Middleware to require user to exist in database
 */
export async function requireDbUser(c: Context<AppEnv>, next: Next) {
  const dbUser = c.get("dbUser");

  if (!dbUser) {
    return c.json({
      error: "User not found",
      message: "Please sync your account first via POST /api/users/sync"
    }, 404);
  }

  return next();
}

/**
 * Role-based access control middleware
 */
export function requireRole(...roles: string[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const userRole = c.get("role") as string | undefined;

    if (!userRole || !roles.includes(userRole)) {
      if (userRole === "waitlist") {
        return c.json({
          error: "Access pending",
          message: "Your account is pending approval. You will be notified when access is granted."
        }, 403);
      }
      return c.json({ error: "Forbidden - insufficient permissions" }, 403);
    }

    return next();
  };
}

/**
 * Admin-only middleware
 */
export const requireAdmin = requireRole("admin");

/**
 * User or admin middleware (excludes waitlist)
 */
export const requireUser = requireRole("user", "admin");

/**
 * Sync user from Clerk to database
 * Creates new user or updates existing one
 * Returns the user with determined role
 */
export function syncUserToDatabase(
  clerkUserId: string,
  email: string,
  name: string | null,
  imageUrl: string | null
): DbUser {
  // Check if user already exists
  let dbUser = userQueries.findByClerkId(clerkUserId);
  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdminEmail = Boolean(adminEmail && email.toLowerCase() === adminEmail.toLowerCase());

  if (dbUser) {
    // Open access: existing waitlist users should not remain stranded after launch.
    if (isAdminEmail && dbUser.role !== "admin") {
      userQueries.updateRole(dbUser.id, "admin");
      dbUser = userQueries.findByClerkId(clerkUserId)!;
    } else if (dbUser.role === "waitlist") {
      userQueries.updateRole(dbUser.id, "user");
      dbUser = userQueries.findByClerkId(clerkUserId)!;
    }
    // Update last active and return
    userQueries.updateLastActive(dbUser.id);
    return dbUser;
  }

  // New users are open-access by default; ADMIN_EMAIL still receives admin role.
  let role: "waitlist" | "user" | "admin" = "user";

  if (isAdminEmail) {
    role = "admin";
  }

  // Get institution and research area from access request if available
  const accessRequest: DbAccessRequest | null = accessRequestQueries.findByEmail(email);
  const institution = accessRequest?.institution || null;
  const researchArea = accessRequest?.research_area || null;

  // Create new user
  const userId = uuidv4();
  userQueries.create(
    userId,
    clerkUserId,
    email,
    name,
    imageUrl,
    role,
    institution,
    researchArea
  );

  // Return the newly created user
  const created = userQueries.findById(userId);
  if (!created) {
    throw new Error(`[syncUserToDatabase] User create succeeded but findById(${userId}) returned null — possible DB write failure`);
  }
  return created;
}

/**
 * Clear user cache (useful for testing)
 */
export function clearUserCache() {
  userCache.clear();
}
