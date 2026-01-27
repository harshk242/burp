import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { UserSchema, ErrorSchema, MessageSchema } from "../schemas";

const users = new OpenAPIHono();

// ============================================
// POST /api/users/sync - Sync user from Clerk after login
// ============================================

const syncUserRoute = createRoute({
  method: "post",
  path: "/sync",
  tags: ["Users"],
  summary: "Sync user from Clerk",
  description: "Sync or create user in database after Clerk authentication. Called automatically on first login.",
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
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    501: {
      description: "Not implemented",
      content: {
        "application/json": {
          schema: MessageSchema,
        },
      },
    },
  },
});

users.openapi(syncUserRoute, async (c) => {
  // TODO: Implement in Phase 2 (Auth)
  return c.json({ message: "Not implemented" }, 501);
});

// ============================================
// GET /api/users/me - Current user info + role
// ============================================

const getCurrentUserRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Users"],
  summary: "Get current user",
  description: "Get the currently authenticated user's profile and role.",
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
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    501: {
      description: "Not implemented",
      content: {
        "application/json": {
          schema: MessageSchema,
        },
      },
    },
  },
});

users.openapi(getCurrentUserRoute, async (c) => {
  // TODO: Implement in Phase 2 (Auth)
  return c.json({ message: "Not implemented" }, 501);
});

export { users };
