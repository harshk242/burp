/**
 * Boot tests: spawn the real server (server/index.ts) against scratch DBs and
 * prove it migrates before listening, serves snake_case rows from the Drizzle
 * query layer, and refuses to start when the migration hits an FK violation.
 */
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildLegacyDb } from "../__test-utils__/legacy";
import { loadMigrations } from "../db/executor";
import { MIGRATIONS_FOLDER } from "../db/paths";

const APP_DIR = join(import.meta.dir, "..", "..");
const TOKEN = "t".repeat(48); // dev-agent bearer token (>= 32 chars, non-production only)
const dir = mkdtempSync(join(tmpdir(), "burp-boot-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

function spawnServer(dbPath: string, actAs: string) {
  const port = freePort();
  const proc = Bun.spawn(["bun", "run", "server/index.ts"], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATABASE_URL: dbPath,
      LOG_DIR: join(dir, "logs"),
      MCP_SERVERS_BASE: join(dir, "no-mcp"), // MCP init fails fast; it never blocks serving
      CLERK_SECRET_KEY: "",
      DEV_AGENT_TOKEN: TOKEN,
      DEV_AGENT_EMAIL: actAs,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}

async function waitForHealth(base: string, proc: Bun.Subprocess): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited early with ${proc.exitCode}`);
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(100);
  }
  throw new Error("server did not become healthy");
}

async function withServer(dbPath: string, actAs: string, fn: (api: Api) => Promise<void>) {
  const { proc, base } = spawnServer(dbPath, actAs);
  try {
    await waitForHealth(base, proc);
    await fn((path, init = {}) =>
      fetch(`${base}/api${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...init.headers },
      })
    );
  } finally {
    proc.kill("SIGTERM");
    await proc.exited;
  }
}

type Api = (path: string, init?: RequestInit) => Promise<Response>;

// Response bodies are asserted on below, so `any` keeps the expectations readable.
async function getJson(api: Api, path: string): Promise<any> {
  return (await api(path)).json();
}

const MIGRATION_COUNT = loadMigrations(MIGRATIONS_FOLDER).length;

function migrationCount(dbPath: string): number {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return sqlite.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM __drizzle_migrations").get()!.n;
  } finally {
    sqlite.close();
  }
}

const USER_KEYS = [
  "clerk_id",
  "created_at",
  "daily_cost_limit_microusd",
  "daily_query_limit",
  "daily_token_limit",
  "email",
  "id",
  "image_url",
  "institution",
  "last_active_at",
  "monthly_cost_limit_microusd",
  "name",
  "research_area",
  "role",
  "total_queries",
];

describe("server boot", () => {
  it("migrates a fresh DB before listening and serves snake_case rows", async () => {
    const dbPath = join(dir, "fresh.db");
    await withServer(dbPath, "dev-agent@example.com", async (api) => {
      const me = await getJson(api, "/users/me");
      expect(Object.keys(me).sort()).toEqual(USER_KEYS);

      const created = await api("/sessions", { method: "POST", body: JSON.stringify({ title: "Boot" }) });
      expect(created.status).toBe(201);
      const { sessions } = await getJson(api, "/sessions");
      expect(sessions).toHaveLength(1);
      expect(Object.keys(sessions[0]).sort()).toEqual(["created_at", "id", "title", "updated_at", "user_id"]);
      expect(sessions[0]).toMatchObject({ title: "Boot", user_id: me.id });

      const waitlist = await api("/waitlist", { method: "POST", body: JSON.stringify({ email: "r@example.com", name: "R" }) });
      expect(waitlist.status).toBe(201);
      const { requests } = await getJson(api, "/waitlist");
      expect(requests[0]).toMatchObject({ email: "r@example.com", status: "pending", reviewed_by: null });
      expect(Object.keys(requests[0])).toContain("submitted_at");

      const usage = await getJson(api, "/usage");
      expect(usage).toMatchObject({ used: 0, total_queries: 0, role: "admin" });
    });
    expect(migrationCount(dbPath)).toBe(MIGRATION_COUNT);

    // Second boot: nothing pending, data intact.
    await withServer(dbPath, "dev-agent@example.com", async (api) => {
      expect((await getJson(api, "/sessions")).sessions).toHaveLength(1);
    });
    expect(migrationCount(dbPath)).toBe(MIGRATION_COUNT);
  }, 30_000);

  it("adopts a legacy (old prod) DB at boot, backs it up and serves its rows", async () => {
    const dbPath = join(dir, "legacy.db");
    const legacy = new Database(dbPath, { create: true });
    legacy.run("PRAGMA foreign_keys = ON");
    buildLegacyDb(legacy, "old-prod");
    legacy.close();

    await withServer(dbPath, "user@example.com", async (api) => {
      const me = await getJson(api, "/users/me");
      expect(Object.keys(me).sort()).toEqual(USER_KEYS);
      expect(me).toMatchObject({ id: "u-user", role: "user", total_queries: 3, created_at: 1700000100 });

      const { sessions } = await getJson(api, "/sessions");
      expect(sessions).toEqual([
        { id: "c-1", user_id: "u-user", title: "Proteins", created_at: 1700000200, updated_at: 1700000300 },
      ]);

      const usage = await getJson(api, "/usage");
      expect(usage).toMatchObject({ limit: 50, total_queries: 3, role: "user" });
    });

    expect(migrationCount(dbPath)).toBe(MIGRATION_COUNT);
    expect(readdirSync(join(dir, "backups")).some((f) => f.startsWith("legacy-pre-drizzle-"))).toBe(true);
  }, 30_000);

  it("refuses to start when the migration finds an FK violation, leaving the DB unadopted", async () => {
    const dbPath = join(dir, "orphan.db");
    const legacy = new Database(dbPath, { create: true });
    buildLegacyDb(legacy, "current");
    legacy.run("PRAGMA foreign_keys = OFF");
    legacy.run("INSERT INTO chat_sessions (id, user_id, title) VALUES ('orphan', 'no-such-user', 'x')");
    legacy.close();

    const { proc } = spawnServer(dbPath, "user@example.com");
    const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);
    expect(await proc.exited).toBe(1);
    clearTimeout(timer);
    const log = await new Response(proc.stdout).text() + (await new Response(proc.stderr).text());
    expect(log).toContain("database_migration_fk_violation");
    expect(log).not.toContain("Status: Running");

    const sqlite = new Database(dbPath, { readonly: true });
    expect(sqlite.query("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").all()).toEqual([]);
    expect(sqlite.query("SELECT id FROM chat_sessions WHERE id = 'orphan'").all()).toHaveLength(1);
    sqlite.close();
  }, 30_000);
});
