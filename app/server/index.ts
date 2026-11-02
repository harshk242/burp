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
import { AUTH_CONFIGURATION_MESSAGE, resolveAuthConfig, validateAuthConfig } from "./auth-config";

validateAuthConfig();
const authConfig = resolveAuthConfig();
if (!authConfig.secretKey) {
  logger.warn("STARTUP", authConfig.development ? "explicit_development_auth" : "auth_not_configured", {
    data: { message: AUTH_CONFIGURATION_MESSAGE },
  });
}

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

const tools = initializeTools();
tools.ready.catch((error) => {
  logger.error("STARTUP", "mcp_init_failed", { error: error instanceof Error ? error : String(error) });
});

if (initTracing()) {
  const writer = scoreWriterFromEnv();
  if (writer) startFeedbackSync({ queries: messageFeedbackQueries, writer, environment: tracingEnvironment });
}

const TURN_DRAIN_TIMEOUT_MS = 2000;
const FLUSH_TIMEOUT_MS = 2500;
let shuttingDown = false;

async function shutdown(signal: "SIGTERM" | "SIGINT") {
  logger.info("SHUTDOWN", `${signal.toLowerCase()}_received`);
  if (shuttingDown) return;
  shuttingDown = true;
  tools.embeddingSync?.stop();
  stopFeedbackSync();
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

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    mcpServers: mcpManager.getAllStatuses(),
  });
});

app.route("/api", api);

app.use("*", serveStatic({ root: "./public" }));

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
  idleTimeout: 255, // seconds (Bun max)
};
