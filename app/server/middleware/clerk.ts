/**
 * Clerk Authentication Middleware for Hono
 * Verifies JWT tokens and manages user sessions
 */

import type { Context, Next } from "hono";
import { createClerkClient } from "@clerk/backend";
import { userQueries, accessRequestQueries } from "../db";
import { v4 as uuidv4 } from "uuid";

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

interface DbUser {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  image_url: string | null;
  role: string;
  institution: string | null;
  research_area: string | null;
  total_queries: number;
  created_at: number;
  last_active_at: number | null;
}

interface AccessRequest {
  id: string;
  email: string;
  name: string;
  institution: string | null;
  research_area: string | null;
  use_case: string | null;
  status: string;
  submitted_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
}

/**
 * Clerk JWT verification middleware
 * Sets userId, email, role, and dbUser on context
 */
export async function clerkAuth(c: Context, next: Next) {
  const clerk = getClerkClient();

  // Development mode - skip auth if no Clerk keys configured
  if (!clerk) {
    console.warn("⚠️  CLERK_SECRET_KEY not set - running in development mode with test user");
    const devClerkId = "dev-clerk-id";
    const devEmail = process.env.ADMIN_EMAIL || "dev@example.com";

    // Sync dev user to database (creates if not exists, makes them admin)
    let dbUser = userQueries.findByClerkId(devClerkId) as DbUser | undefined;
    if (!dbUser) {
      const userId = uuidv4();
      userQueries.create(userId, devClerkId, devEmail, "Dev User", null, "admin", null, null);
      dbUser = userQueries.findById(userId) as DbUser;
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
    const payload = await clerk.verifyToken(token);
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
    const dbUser = userQueries.findByClerkId(clerkUserId) as DbUser | undefined;

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
    console.error("Auth error:", err);

    if (err instanceof Error && err.message.includes("expired")) {
      return c.json({ error: "Token expired" }, 401);
    }

    return c.json({ error: "Invalid token" }, 401);
  }
}

/**
 * Middleware to require user to exist in database
 */
export async function requireDbUser(c: Context, next: Next) {
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
  return async (c: Context, next: Next) => {
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
  let dbUser = userQueries.findByClerkId(clerkUserId) as DbUser | undefined;

  if (dbUser) {
    // User exists - update last active and return
    userQueries.updateLastActive(dbUser.id);
    return dbUser;
  }

  // New user - determine role based on access request and admin email
  let role: "waitlist" | "user" | "admin" = "waitlist";

  // Check if this is the admin email
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && email.toLowerCase() === adminEmail.toLowerCase()) {
    role = "admin";
  } else {
    // Check if they have an approved access request
    const accessRequest = accessRequestQueries.findByEmail(email) as AccessRequest | undefined;
    if (accessRequest?.status === "approved") {
      role = "user";
    }
  }

  // Get institution and research area from access request if available
  const accessRequest = accessRequestQueries.findByEmail(email) as AccessRequest | undefined;
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
  return userQueries.findById(userId) as DbUser;
}

/**
 * Clear user cache (useful for testing)
 */
export function clearUserCache() {
  userCache.clear();
}
