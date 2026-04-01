import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { UserSchema, ErrorSchema, MessageSchema } from "../schemas";
import { clerkAuth, syncUserToDatabase, requireDbUser } from "../middleware/clerk";
import type { AppEnv } from "../types";

const users = new OpenAPIHono<AppEnv>();

// Apply Clerk auth to all user routes
users.use("*", clerkAuth);

// ============================================
// POST /api/users/sync - Sync user from Clerk after login
// ============================================

const syncUserRoute = createRoute({
  method: "post",
  path: "/sync",
  tags: ["Users"],
  summary: "Sync user from Clerk",
  description: `Sync or create user in database after Clerk authentication.

This endpoint should be called after a user signs in via Clerk for the first time.
It creates a user record in the database with the appropriate role:

- **admin**: If the user's email matches ADMIN_EMAIL env var
- **user**: If the user has an approved access request
- **waitlist**: Default for new users without an approved request

The endpoint is idempotent - calling it multiple times for the same user is safe.`,
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "User synced successfully",
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
    },
    401: {
      description: "Unauthorized - invalid or missing token",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

users.openapi(syncUserRoute, async (c) => {
  const clerkUserId = c.get("clerkUserId") as string;
  const email = c.get("email") as string;
  const name = c.get("clerkName") as string | null;
  const imageUrl = c.get("clerkImageUrl") as string | null;

  // Sync user to database (creates if not exists)
  const user = syncUserToDatabase(clerkUserId, email, name, imageUrl);

  return c.json(user, 200);
});

// ============================================
// GET /api/users/me - Current user info + role
// ============================================

const getCurrentUserRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Users"],
  summary: "Get current user",
  description: `Get the currently authenticated user's profile and role.

The user must have synced their account via POST /api/users/sync first.

Returns user profile including:
- Basic info (name, email, image)
- Role (waitlist, user, admin)
- Institution and research area (if provided)
- Usage stats (total queries)`,
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Current user profile",
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
    },
    401: {
      description: "Unauthorized - invalid or missing token",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: "User not found - sync required",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
  },
});

users.openapi(getCurrentUserRoute, async (c) => {
  const dbUser = c.get("dbUser");

  if (!dbUser) {
    return c.json({
      error: "User not found",
      message: "Please sync your account first via POST /api/users/sync"
    }, 404);
  }

  return c.json(dbUser, 200);
});

export { users };
