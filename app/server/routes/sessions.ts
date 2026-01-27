import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { v4 as uuidv4 } from "uuid";
import { chatSessionQueries, messageQueries } from "../db";
import {
  CreateSessionSchema,
  SessionCreatedSchema,
  SessionListSchema,
  SessionWithMessagesSchema,
  UpdateSessionSchema,
  ErrorSchema,
  MessageSchema,
} from "../schemas";

const sessions = new OpenAPIHono();

// ============================================
// GET /api/sessions - List user's chat sessions
// ============================================

const listSessionsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Sessions"],
  summary: "List chat sessions",
  description: "Get all chat sessions for the authenticated user.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of chat sessions",
      content: {
        "application/json": {
          schema: SessionListSchema,
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
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

sessions.openapi(listSessionsRoute, async (c) => {
  // TODO: Get user_id from auth context in Phase 2
  const userId = c.get("userId") || "test-user";

  try {
    const chatSessions = chatSessionQueries.findByUserId(userId);
    return c.json({ sessions: chatSessions }, 200);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================
// POST /api/sessions - Create new chat session
// ============================================

const createSessionRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Sessions"],
  summary: "Create chat session",
  description: "Create a new chat session for the authenticated user.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateSessionSchema,
        },
      },
      required: false,
    },
  },
  responses: {
    201: {
      description: "Session created successfully",
      content: {
        "application/json": {
          schema: SessionCreatedSchema,
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
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

sessions.openapi(createSessionRoute, async (c) => {
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

// ============================================
// GET /api/sessions/:id - Get chat session with messages
// ============================================

const getSessionRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Sessions"],
  summary: "Get chat session",
  description: "Get a chat session with all its messages.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
  },
  responses: {
    200: {
      description: "Chat session with messages",
      content: {
        "application/json": {
          schema: SessionWithMessagesSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

sessions.openapi(getSessionRoute, async (c) => {
  const { id } = c.req.valid("param");

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

    return c.json({ session, messages: parsedMessages }, 200);
  } catch (error) {
    console.error("Error fetching session:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================
// DELETE /api/sessions/:id - Delete chat session
// ============================================

const deleteSessionRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Sessions"],
  summary: "Delete chat session",
  description: "Delete a chat session and all its messages.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
  },
  responses: {
    200: {
      description: "Session deleted",
      content: {
        "application/json": {
          schema: MessageSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

sessions.openapi(deleteSessionRoute, async (c) => {
  const { id } = c.req.valid("param");

  try {
    const session = chatSessionQueries.findById(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Messages are cascade deleted due to foreign key
    chatSessionQueries.delete(id);
    return c.json({ message: "Session deleted" }, 200);
  } catch (error) {
    console.error("Error deleting session:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================
// PATCH /api/sessions/:id - Update session title
// ============================================

const updateSessionRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Sessions"],
  summary: "Update chat session",
  description: "Update the title of a chat session.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
    body: {
      content: {
        "application/json": {
          schema: UpdateSessionSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Session updated",
      content: {
        "application/json": {
          schema: MessageSchema,
        },
      },
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: "Session not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

sessions.openapi(updateSessionRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { title } = c.req.valid("json");

  try {
    const session = chatSessionQueries.findById(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    chatSessionQueries.updateTitle(id, title);
    return c.json({ message: "Session updated" }, 200);
  } catch (error) {
    console.error("Error updating session:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { sessions };
