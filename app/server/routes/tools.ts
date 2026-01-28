import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ToolListSchema, ToolSearchQuerySchema, ErrorSchema, MCPToolSchema } from "../schemas";
import { clerkAuth, requireUser, requireDbUser } from "../middleware/clerk";

const tools = new OpenAPIHono();

// Apply Clerk auth and user role check to all tool routes
tools.use("*", clerkAuth, requireDbUser, requireUser);

// ============================================
// GET /api/tools - List all available tools
// ============================================

const listToolsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Tools"],
  summary: "List all tools",
  description: "Get a list of all available MCP tools across all biomedical databases.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of available tools",
      content: {
        "application/json": {
          schema: ToolListSchema,
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
    403: {
      description: "Forbidden - User role required",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

tools.openapi(listToolsRoute, async (c) => {
  // TODO: Implement in Phase 3 (Gateway) - get tools from MCP registry
  return c.json({
    tools: [],
    count: 0,
  }, 200);
});

// ============================================
// GET /api/tools/search - Search tools by name/description
// ============================================

const searchToolsRoute = createRoute({
  method: "get",
  path: "/search",
  tags: ["Tools"],
  summary: "Search tools",
  description: "Search for tools by name or description keyword.",
  security: [{ bearerAuth: [] }],
  request: {
    query: ToolSearchQuerySchema,
  },
  responses: {
    200: {
      description: "Search results",
      content: {
        "application/json": {
          schema: ToolListSchema,
        },
      },
    },
    400: {
      description: "Missing search query",
      content: {
        "application/json": {
          schema: ErrorSchema,
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
    403: {
      description: "Forbidden - User role required",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

tools.openapi(searchToolsRoute, async (c) => {
  const { q } = c.req.valid("query");

  // TODO: Implement in Phase 3 (Gateway) - search MCP registry
  return c.json({
    tools: [],
    count: 0,
  }, 200);
});

// ============================================
// POST /api/tools/:server/:name - Direct tool call
// ============================================

const callToolRoute = createRoute({
  method: "post",
  path: "/{server}/{name}",
  tags: ["Tools"],
  summary: "Call a tool directly",
  description: "Execute a specific MCP tool with the provided input parameters.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      server: z.string().openapi({ example: "uniprot", description: "MCP server name" }),
      name: z.string().openapi({ example: "search_proteins", description: "Tool name" }),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.record(z.unknown()).openapi({ example: { query: "BRCA1" } }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Tool execution result",
      content: {
        "application/json": {
          schema: z.object({
            result: z.unknown(),
          }),
        },
      },
    },
    400: {
      description: "Invalid input",
      content: {
        "application/json": {
          schema: ErrorSchema,
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
    403: {
      description: "Forbidden - User role required",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: "Tool not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Tool execution failed",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

tools.openapi(callToolRoute, async (c) => {
  const { server, name } = c.req.valid("param");

  // TODO: Implement in Phase 3 (Gateway) - call MCP tool directly
  return c.json({
    error: "Direct tool calls will be implemented in Phase 3",
  }, 501);
});

export { tools };
