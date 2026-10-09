import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { join } from "path";
import { DB_PATH, MigrationFkError, runMigrations, sqlite } from "./db";
import { api } from "./routes";
import { mcpManager } from "./mcp/manager";
import { toolRegistry } from "./mcp/registry";
import { hybridSearch } from "./search";
import { getEmbeddingModel } from "./llm";
import { logger, startTimer, generateRequestId } from "./logger";
import { appConfig } from "./config";
import { redirectWwwToCanonical } from "./middleware/canonical-host";
import type { AppEnv } from "./types";

// Apply pending migrations (adopting a legacy DB if needed) before listening.
// Any failure rolls the migration transaction back, so the DB is unchanged and
// we refuse to start rather than serve against a half-migrated schema.
try {
  const { applied, adopted, backupPath, transactionMs } = runMigrations(sqlite);
  logger.info("STARTUP", "database_migrated", {
    duration_ms: transactionMs === null ? undefined : Math.round(transactionMs),
    data: { db_path: DB_PATH, adopted, applied: applied.map((m) => m.tag).join(",") || "none", backup: backupPath },
  });
} catch (error) {
  const event = error instanceof MigrationFkError ? "database_migration_fk_violation" : "database_migration_failed";
  logger.error("STARTUP", event, { data: { db_path: DB_PATH }, error: error instanceof Error ? error : String(error) });
  logger.flush();
  process.exit(1);
}

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

const app = new Hono<AppEnv>();

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

// Canonicalize before CORS, API routes, and static files so browser clients are same-origin.
app.use("*", redirectWwwToCanonical);

app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = appConfig.server.cors_origins;
      return allowed.includes(origin) ? origin : undefined;
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
║           BURP Server                                     ║
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
