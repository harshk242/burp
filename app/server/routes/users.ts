import { Hono } from "hono";

const users = new Hono();

// POST /api/users/sync - Sync user from Clerk after login
users.post("/sync", async (c) => {
  // TODO: Implement in Phase 2 (Auth)
  return c.json({ message: "Not implemented" }, 501);
});

// GET /api/users/me - Current user info + role
users.get("/me", async (c) => {
  // TODO: Implement in Phase 2 (Auth)
  return c.json({ message: "Not implemented" }, 501);
});

export { users };
