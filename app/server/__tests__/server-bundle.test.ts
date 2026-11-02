import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { APP_DIR } from "../app-dir";
import { loadMigrations } from "../db/executor";
import { MIGRATIONS_FOLDER } from "../db/paths";

// Production runs the minified bundle, not source. Boot it from an image-shaped layout so
// bundler-only regressions (import.meta paths, externals, entry semantics) fail here.
const TOKEN = "t".repeat(48);
const root = mkdtempSync(join(tmpdir(), "burp-bundle-"));
const appRoot = join(root, "app");
let bundlePath = "";

beforeAll(async () => {
  // Subprocess, like the Dockerfile: in-process Bun.build is disturbed by other test files' module state.
  const build = Bun.spawnSync(["bun", join(APP_DIR, "scripts", "build-server.ts"), appRoot], { stdout: "pipe", stderr: "pipe" });
  if (!build.success) throw new Error(`build:server failed: ${build.stderr.toString()}`);
  bundlePath = join(appRoot, "server", "index.js");
  cpSync(MIGRATIONS_FOLDER, join(appRoot, "server", "db", "migrations"), { recursive: true });
  symlinkSync(join(APP_DIR, "config.yaml"), join(appRoot, "config.yaml"));
  symlinkSync(join(APP_DIR, "node_modules"), join(appRoot, "node_modules"));
  mkdirSync(join(appRoot, "public"));
  writeFileSync(join(appRoot, "public", "index.html"), "<p>bundle-static</p>");
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

async function bootBundle(dbPath: string) {
  const port = freePort();
  const proc = Bun.spawn(["bun", bundlePath], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATABASE_URL: dbPath,
      LOG_DIR: join(root, "logs"),
      MCP_SERVERS_BASE: join(root, "no-mcp"),
      CLERK_SECRET_KEY: "",
      AUTH_MODE: "clerk",
      DEV_AGENT_TOKEN: TOKEN,
      DEV_AGENT_EMAIL: "dev-agent@example.com",
      LANGFUSE_ENABLED: "false",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`bundle exited early with ${proc.exitCode}: ${await new Response(proc.stderr).text()}`);
    }
    try {
      if ((await fetch(`${base}/health`)).ok) return { proc, base };
    } catch {
    }
    await Bun.sleep(100);
  }
  proc.kill("SIGKILL");
  throw new Error("bundle did not become healthy");
}

function migrationCount(dbPath: string): number {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return sqlite.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM __drizzle_migrations").get()!.n;
  } finally {
    sqlite.close();
  }
}

describe("production server bundle", () => {
  it("keeps node-jq external so its jq binary resolves from node_modules", () => {
    const bundle = readFileSync(bundlePath, "utf-8");
    expect(/\.resolve\("node-jq"\)/.test(bundle)).toBe(true);
    expect(bundle.trimEnd().endsWith("//# sourceMappingURL=index.js.map")).toBe(true);
  });

  it("migrates fresh and existing DBs, serves API and static files, and stops on SIGTERM", async () => {
    const dbPath = join(root, "app.db");
    for (const run of ["fresh", "existing"]) {
      const { proc, base } = await bootBundle(dbPath);
      try {
        expect(migrationCount(dbPath)).toBe(loadMigrations(MIGRATIONS_FOLDER).length);
        const me = await fetch(`${base}/api/users/me`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        expect(me.status).toBe(200);
        expect(((await me.json()) as { email: string }).email).toBe("dev-agent@example.com");
        expect(await (await fetch(`${base}/index.html`)).text()).toContain("bundle-static");
      } finally {
        proc.kill("SIGTERM");
      }
      expect(await proc.exited, `${run} boot exit code`).toBe(0);
    }
  }, 60_000);
});
