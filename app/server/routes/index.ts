import { Hono } from "hono";
import { users } from "./users";
import { waitlist } from "./waitlist";
import { sessions } from "./sessions";
import { tools } from "./tools";
import { chat } from "./chat";

const api = new Hono();

// Mount route modules
api.route("/users", users);
api.route("/waitlist", waitlist);
api.route("/sessions", sessions);
api.route("/tools", tools);
api.route("/chat", chat);

// API root
api.get("/", (c) => {
  return c.json({
    name: "Super Bio Agent API",
    version: "1.0.0",
    endpoints: {
      "POST /api/users/sync": "Sync user from Clerk",
      "GET /api/users/me": "Get current user",
      "POST /api/waitlist": "Submit access request",
      "GET /api/waitlist": "List pending requests (admin)",
      "POST /api/waitlist/:id/approve": "Approve request (admin)",
      "GET /api/sessions": "List chat sessions",
      "POST /api/sessions": "Create chat session",
      "GET /api/sessions/:id": "Get session with messages",
      "DELETE /api/sessions/:id": "Delete session",
      "GET /api/tools": "List all tools",
      "GET /api/tools/search": "Search tools",
      "POST /api/chat": "Chat (SSE streaming)",
    },
  });
});

export { api };
