import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { initializeSchema } from "./db";
import { api } from "./routes";
import { mcpManager } from "./mcp/manager";
import { toolRegistry } from "./mcp/registry";

// Initialize database on startup
initializeSchema();

// Initialize MCP servers and tool discovery
async function initializeMCP() {
  console.log("[Startup] Registering MCP servers...");
  mcpManager.registerAll();

  console.log("[Startup] Starting MCP servers (best-effort)...");
  await mcpManager.startAll();

  console.log("[Startup] Discovering tools from running servers...");
  await toolRegistry.discoverTools(mcpManager);

  console.log(`[Startup] Ready with ${toolRegistry.availableCount}/${toolRegistry.count} tools available`);
}

// Start MCP initialization (don't block server startup)
initializeMCP().catch((error) => {
  console.error("[Startup] MCP initialization error:", error);
  // Don't exit - server can still handle requests, just without tools
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Shutdown] Received SIGTERM, stopping MCP servers...");
  await mcpManager.stopAll();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Shutdown] Received SIGINT, stopping MCP servers...");
  await mcpManager.stopAll();
  process.exit(0);
});

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
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

const port = parseInt(process.env.PORT || "3000");

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
  fetch: app.fetch,
};
