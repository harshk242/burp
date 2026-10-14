import type { Context, Next } from "hono";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { userQueries, accessRequestQueries } from "../db";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import type { AppEnv, DbUser, DbAccessRequest } from "../types";
import { AUTH_CONFIGURATION_MESSAGE, resolveAuthConfig } from "../auth-config";
import { isValidDevAgentToken } from "./devAgentAuth";

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient(secretKey: string | null) {
  if (!secretKey) return null;
  if (!clerkClient) {
    clerkClient = createClerkClient({
      secretKey,
    });
  }
  return clerkClient;
}

const userCache = new Map<string, { email: string; name: string | null; imageUrl: string | null; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function setDevelopmentUser(
  c: Context<AppEnv>,
  clerkId: string,
  email: string,
  name: string,
  existingUser: DbUser | null = null
) {
  let dbUser = existingUser ?? userQueries.findByClerkId(clerkId);
  if (!dbUser) {
    const userId = uuidv4();
    userQueries.create(userId, clerkId, email, name, null, "admin", null, null);
    dbUser = userQueries.findById(userId);
    if (!dbUser) {
      throw new Error(`[clerkAuth] Dev user create succeeded but findById(${userId}) returned null`);
    }
  }

  c.set("clerkUserId", dbUser.clerk_id);
  c.set("userId", dbUser.id);
  c.set("email", dbUser.email);
  c.set("role", dbUser.role);
  c.set("dbUser", dbUser);
  c.set("clerkName", dbUser.name);
  c.set("clerkImageUrl", dbUser.image_url);
}

export async function clerkAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (isValidDevAgentToken(token)) {
    const agentEmail = process.env.DEV_AGENT_EMAIL || "dev-agent@example.com";
    const existingUser = userQueries.findByEmail(agentEmail);
    logger.info("AUTH", "dev_agent_authenticated", { data: { actingAsExistingUser: Boolean(existingUser) } });
    setDevelopmentUser(c, "dev-agent-clerk-id", agentEmail, "Development Agent", existingUser);
    return next();
  }

  const { secretKey, development } = resolveAuthConfig();
  const clerk = getClerkClient(secretKey);

  if (!clerk || !secretKey) {
    if (!development) {
      return c.json({ error: "auth_not_configured", message: AUTH_CONFIGURATION_MESSAGE }, 503);
    }
    logger.warn("AUTH", "explicit_development_auth");
    setDevelopmentUser(
      c,
      "dev-clerk-id",
      process.env.ADMIN_EMAIL || "dev@example.com",
      "Dev User"
    );
    return next();
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized - missing or invalid Authorization header" }, 401);
  }

  if (!token) {
    return c.json({ error: "Unauthorized - empty token" }, 401);
  }

  try {
    const payload = await verifyToken(token, { secretKey });
    const clerkUserId = payload.sub;

    if (!clerkUserId) {
      return c.json({ error: "Invalid token - missing subject" }, 401);
    }

    let userInfo = userCache.get(clerkUserId);

    if (!userInfo || userInfo.expiresAt < Date.now()) {
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

    const dbUser = userQueries.findByClerkId(clerkUserId);

    c.set("clerkUserId", clerkUserId);
    c.set("email", userInfo.email);
    c.set("clerkName", userInfo.name);
    c.set("clerkImageUrl", userInfo.imageUrl);

    if (dbUser) {
      c.set("userId", dbUser.id);
      c.set("role", dbUser.role);
      c.set("dbUser", dbUser);

      try {
        userQueries.updateLastActive(dbUser.id);
      } catch {}
    } else {
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

export const requireAdmin = requireRole("admin");

export const requireUser = requireRole("user", "admin");

export function syncUserToDatabase(
  clerkUserId: string,
  email: string,
  name: string | null,
  imageUrl: string | null
): DbUser {
  let dbUser = userQueries.findByClerkId(clerkUserId);
  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdminEmail = Boolean(adminEmail && email.toLowerCase() === adminEmail.toLowerCase());

  if (dbUser) {
    if (isAdminEmail && dbUser.role !== "admin") {
      userQueries.updateRole(dbUser.id, "admin");
      dbUser = userQueries.findByClerkId(clerkUserId)!;
    } else if (dbUser.role === "waitlist") {
      userQueries.updateRole(dbUser.id, "user");
      dbUser = userQueries.findByClerkId(clerkUserId)!;
    }
    userQueries.updateLastActive(dbUser.id);
    return dbUser;
  }

  let role: "waitlist" | "user" | "admin" = "user";

  if (isAdminEmail) {
    role = "admin";
  }

  const accessRequest: DbAccessRequest | null = accessRequestQueries.findByEmail(email);
  const institution = accessRequest?.institution || null;
  const researchArea = accessRequest?.research_area || null;

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

  const created = userQueries.findById(userId);
  if (!created) {
    throw new Error(`[syncUserToDatabase] User create succeeded but findById(${userId}) returned null — possible DB write failure`);
  }
  return created;
}

export function clearUserCache() {
  userCache.clear();
}
