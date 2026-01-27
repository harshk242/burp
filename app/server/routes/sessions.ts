import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { chatSessionQueries, messageQueries } from "../db";

const sessions = new Hono();

// GET /api/sessions - List user's chat sessions
sessions.get("/", async (c) => {
  // TODO: Get user_id from auth context in Phase 2
  const userId = c.get("userId") || "test-user";

  try {
    const chatSessions = chatSessionQueries.findByUserId(userId);
    return c.json({ sessions: chatSessions });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/sessions - Create new chat session
sessions.post("/", async (c) => {
  // TODO: Get user_id from auth context in Phase 2
  const userId = c.get("userId") || "test-user";

  try {
    const body = await c.req.json().catch(() => ({}));
    const { title } = body;

    const id = uuidv4();
    chatSessionQueries.create(id, userId, title || "New Chat");

    return c.json({ id, title: title || "New Chat" }, 201);
  } catch (error) {
    console.error("Error creating session:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/sessions/:id - Get chat session with messages
sessions.get("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const session = chatSessionQueries.findById(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const messages = messageQueries.findByChatId(id);

    // Parse tool_calls JSON for each message
    const parsedMessages = (messages as any[]).map((msg) => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
    }));

    return c.json({ session, messages: parsedMessages });
  } catch (error) {
    console.error("Error fetching session:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /api/sessions/:id - Delete chat session
sessions.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const session = chatSessionQueries.findById(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Messages are cascade deleted due to foreign key
    chatSessionQueries.delete(id);
    return c.json({ message: "Session deleted" });
  } catch (error) {
    console.error("Error deleting session:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /api/sessions/:id - Update session title
sessions.patch("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    const body = await c.req.json();
    const { title } = body;

    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }

    const session = chatSessionQueries.findById(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    chatSessionQueries.updateTitle(id, title);
    return c.json({ message: "Session updated" });
  } catch (error) {
    console.error("Error updating session:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { sessions };
