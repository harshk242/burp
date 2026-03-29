import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { join } from "path";
import { initializeSchema } from "./db";
import { api } from "./routes";
import { mcpManager } from "./mcp/manager";
import { toolRegistry } from "./mcp/registry";
import { hybridSearch } from "./search";
import { getEmbeddingModel } from "./llm";
import { logger, startTimer, generateRequestId } from "./logger";
import { appConfig } from "./config";

// Initialize database on startup
initializeSchema();
logger.info("STARTUP", "database_initialized");

// Initialize MCP servers and tool discovery
async function initializeMCP() {
  const elapsed = startTimer();

  logger.info("STARTUP", "mcp_init_start");
  mcpManager.registerAll();

  logger.info("STARTUP", "mcp_servers_starting");
  const { succeeded, failed } = await mcpManager.startAll();

  logger.info("STARTUP", "mcp_servers_started", {
    data: { succeeded, failed, total: succeeded + failed },
  });

  logger.info("STARTUP", "tool_discovery_start");
  await toolRegistry.discoverTools(mcpManager);

  // Index tools for hybrid search
  const allTools = toolRegistry.getAll(false).map((t) => ({
    fullName: `${t.server}__${t.name}`,
    server: t.server,
    toolName: t.name,
    description: t.description,
  }));
  hybridSearch.indexTools(allTools);

  // Load precomputed embeddings (optional — BM25 works without them)
  try {
    const embPath = join(process.cwd(), "..", "data", "tool-embeddings.json");
    hybridSearch.loadEmbeddings(embPath);
    hybridSearch.setEmbeddingModel(getEmbeddingModel());
  } catch (e) {
    logger.warn("STARTUP", "embeddings_load_failed", {
      error: e instanceof Error ? e : String(e),
    });
  }

  logger.info("STARTUP", "mcp_init_complete", {
    duration_ms: elapsed(),
    data: {
      tools_available: toolRegistry.availableCount,
      tools_total: toolRegistry.count,
      search_indexed: hybridSearch.indexed,
      embeddings_loaded: hybridSearch.embeddingsLoaded,
    },
  });
}

// Start MCP initialization (don't block server startup)
initializeMCP().catch((error) => {
  logger.error("STARTUP", "mcp_init_failed", { error: error instanceof Error ? error : String(error) });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SHUTDOWN", "sigterm_received");
  await mcpManager.stopAll();
  logger.flush();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SHUTDOWN", "sigint_received");
  await mcpManager.stopAll();
  logger.flush();
  process.exit(0);
});

const app = new Hono();

// Middleware - HTTP request logging
app.use("*", async (c, next) => {
  const rid = generateRequestId();
  c.set("requestId", rid);
  const elapsed = startTimer();
  const method = c.req.method;
  const path = c.req.path;

  logger.info("HTTP", "request_start", {
    data: { method, path },
    ctx: { request_id: rid },
  });

  await next();

  const status = c.res.status;
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  logger[level]("HTTP", "request_end", {
    duration_ms: elapsed(),
    data: { method, path, status },
    ctx: { request_id: rid },
  });
});
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = appConfig.server.cors_origins;
      return allowed.includes(origin) ? origin : allowed[0];
    },
    credentials: true,
  })
);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    mcpServers: mcpManager.getAllStatuses(),
  });
});

// Mount API routes
app.route("/api", api);

// Static files (will serve Next.js static export in production)
// IMPORTANT: Register API routes FIRST, static files LAST
app.use("*", serveStatic({ root: "./public" }));

// Fallback to index.html for client-side routing
app.use("*", serveStatic({ root: "./public", path: "index.html" }));

const port = appConfig.server.port;

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Super Bio Agent Server                          ║
╠═══════════════════════════════════════════════════════════╣
║  Status: Running                                          ║
║  Port: ${port}                                               ║
║  Health: http://localhost:${port}/health                     ║
║  API: http://localhost:${port}/api                           ║
╚═══════════════════════════════════════════════════════════╝
`);

export default {
  port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  idleTimeout: 255, // seconds (Bun max) — SSE streams idle during tool summarization
};
