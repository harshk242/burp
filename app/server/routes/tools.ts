import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ToolListSchema, ToolSearchQuerySchema, ErrorSchema, MCPToolSchema } from "../schemas";
import { clerkAuth, requireUser, requireDbUser } from "../middleware/clerk";
import { toolRegistry } from "../mcp/registry";
import { mcpManager } from "../mcp/manager";
import { hybridSearch } from "../search";
import { logger, startTimer } from "../logger";
import type { AppEnv } from "../types";

const tools = new OpenAPIHono<AppEnv>();

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
  const allTools = toolRegistry.getAll(true); // Include unavailable tools
  return c.json({
    tools: allTools,
    count: allTools.length,
  }, 200);
});

// ============================================
// GET /api/tools/config - Verify tool loading configuration
// ============================================

const toolConfigRoute = createRoute({
  method: "get",
  path: "/config",
  tags: ["Tools"],
  summary: "Get tool configuration",
  description: "Verify the tool loading configuration including always-loaded and deferred tools.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Tool configuration details",
      content: {
        "application/json": {
          schema: z.object({
            total: z.number(),
            alwaysLoaded: z.object({
              count: z.number(),
              names: z.array(z.string()),
            }),
            deferred: z.object({
              count: z.number(),
            }),
            expectedAlwaysLoaded: z.array(z.string()),
          }),
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

tools.openapi(toolConfigRoute, async (c) => {
  const claudeTools = toolRegistry.toClaudeFormat(true);
  const alwaysLoaded = claudeTools.filter((t) => !t.defer_loading);
  const deferred = claudeTools.filter((t) => t.defer_loading);

  return c.json({
    total: claudeTools.length,
    alwaysLoaded: {
      count: alwaysLoaded.length,
      names: alwaysLoaded.map((t) => t.name),
    },
    deferred: {
      count: deferred.length,
    },
    expectedAlwaysLoaded: toolRegistry.getAlwaysLoadedTools(),
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

  const results = toolRegistry.search(q, true); // Include unavailable tools
  return c.json({
    tools: results,
    count: results.length,
  }, 200);
});

// ============================================
// GET /api/tools/hybrid-search - Hybrid search (BM25 + semantic)
// ============================================

const hybridSearchRoute = createRoute({
  method: "get",
  path: "/hybrid-search",
  tags: ["Tools"],
  summary: "Hybrid tool search",
  description: "Search tools using BM25 + semantic embedding fusion. For debugging and tuning.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      q: z.string().min(1).openapi({ example: "protein structure" }),
    }),
  },
  responses: {
    200: {
      description: "Hybrid search results",
      content: {
        "application/json": {
          schema: z.object({
            results: z.array(z.object({
              fullName: z.string(),
              server: z.string(),
              toolName: z.string(),
              description: z.string(),
              score: z.number(),
              bm25Rank: z.number().optional(),
              semanticRank: z.number().optional(),
            })),
            count: z.number(),
            query: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Missing query",
      content: { "application/json": { schema: ErrorSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

tools.openapi(hybridSearchRoute, async (c) => {
  const { q } = c.req.valid("query");
  const elapsed = startTimer();
  const results = await hybridSearch.search(q);
  logger.info("TOOL", "hybrid_search_api", {
    duration_ms: elapsed(),
    data: { query: q, result_count: results.length },
  });
  return c.json({ results, count: results.length, query: q }, 200);
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
            result: z.any(),
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
    503: {
      description: "MCP server unavailable",
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
  const input = await c.req.json();
  const elapsed = startTimer();

  const tool = toolRegistry.get(server, name);
  if (!tool) {
    logger.warn("TOOL", "direct_call_not_found", { data: { server, tool: name } });
    return c.json({ error: `Tool '${name}' not found on server '${server}'` }, 404);
  }

  if (!tool.available || !mcpManager.isServerAvailable(server)) {
    logger.warn("TOOL", "direct_call_unavailable", { data: { server, tool: name } });
    return c.json({ error: `Server '${server}' is not available` }, 503);
  }

  logger.info("TOOL", "direct_call_start", { data: { server, tool: name, input } });

  try {
    const result = await mcpManager.callTool(server, name, input);
    logger.info("TOOL", "direct_call_success", { duration_ms: elapsed(), data: { server, tool: name } });
    return c.json({ result: result.content }, 200);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Tool execution failed";
    logger.error("TOOL", "direct_call_failed", { duration_ms: elapsed(), data: { server, tool: name }, error: error instanceof Error ? error : errorMsg });
    return c.json({ error: errorMsg }, 500);
  }
});

export { tools };
