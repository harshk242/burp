import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { DB_PATH, MigrationFkError, messageFeedbackQueries, runMigrations, sqlite } from "./db";
import { api } from "./routes";
import { mcpManager } from "./mcp/manager";
import { initializeTools } from "./boot/tools";
import { logger, startTimer, generateRequestId } from "./logger";
import { appConfig } from "./config";
import { redirectWwwToCanonical } from "./middleware/canonical-host";
import { abortActiveTurns } from "./orchestration/chat-turn";
import { initTracing, shutdownTracing, tracingEnvironment } from "./observability/langfuse";
import { startFeedbackSync, stopFeedbackSync } from "./observability/feedback-sync";
import { scoreWriterFromEnv } from "./observability/score-writer";
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

// MCP servers, tool discovery, tool search and embeddings (boot/tools.ts).
// Runs in the background: the server listens while tools come up.
const tools = initializeTools();
tools.ready.catch((error) => {
  logger.error("STARTUP", "mcp_init_failed", { error: error instanceof Error ? error : String(error) });
});

// Langfuse tracing (observability/langfuse.ts); a no-op without keys. While
// it is on, 👍/👎 feedback syncs to Langfuse and pending rows are reconciled
// now and every 5 min (observability/feedback-sync.ts).
if (initTracing()) {
  const writer = scoreWriterFromEnv();
  if (writer) startFeedbackSync({ queries: messageFeedbackQueries, writer, environment: tracingEnvironment });
}

// Graceful shutdown, shared by SIGTERM (Fly) and SIGINT. In-flight turns are
// aborted and drained first (their cleanup ends the trace and writes the
// failed-turn rows), then tracing is flushed alongside the MCP stop. The
// bounds add up to 4.5 s, inside Fly's 5 s kill_timeout.
const TURN_DRAIN_TIMEOUT_MS = 2000;
const FLUSH_TIMEOUT_MS = 2500;
let shuttingDown = false;

async function shutdown(signal: "SIGTERM" | "SIGINT") {
  logger.info("SHUTDOWN", `${signal.toLowerCase()}_received`);
  if (shuttingDown) return; // a second signal changes nothing
  shuttingDown = true;
  tools.embeddingSync?.stop();
  stopFeedbackSync(); // pending rows stay pending; the next boot reconciles them
  const stillRunning = await abortActiveTurns(TURN_DRAIN_TIMEOUT_MS);
  if (stillRunning > 0) logger.warn("SHUTDOWN", "turn_drain_timeout", { data: { turns: stillRunning } });
  await Promise.all([
    shutdownTracing({ timeoutMs: FLUSH_TIMEOUT_MS }),
    Promise.race([
      mcpManager.stopAll().catch((error) =>
        logger.error("SHUTDOWN", "mcp_stop_failed", { error: error instanceof Error ? error : String(error) })
      ),
      Bun.sleep(FLUSH_TIMEOUT_MS),
    ]),
  ]);
  logger.flush();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

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
