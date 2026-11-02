// Smoke-tests the production Docker image the way Fly runs it: fly.toml [build.args] and [env],
// a fresh volume at the [mounts] path, NODE_ENV=production. Covers what the source-level bundle
// test (app/server/__tests__/server-bundle.test.ts) cannot: alpine/musl, node_modules installed
// in the image (node-jq's jq binary), the MCP server under node, the real web export, Dockerfile
// COPY coverage, and a clean SIGTERM exit within kill_timeout. Only unauthenticated routes are
// checked: the dev-agent token is disabled in production.
// Usage: bun scripts/smoke-image.ts [--image <tag>]   (default: build ./Dockerfile)
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const BOOT_TIMEOUT_MS = 30_000;

interface FlyConfig {
  kill_timeout?: string;
  build?: { dockerfile?: string; args?: Record<string, string> };
  env?: Record<string, string>;
  http_service: { internal_port: number };
  mounts: { destination: string };
}

const fly = Bun.TOML.parse(await Bun.file(join(REPO_ROOT, "fly.toml")).text()) as FlyConfig;
const killTimeoutSec = Number.parseInt(fly.kill_timeout ?? "5s", 10);
const internalPort = fly.http_service.internal_port;

function docker(...args: string[]): string {
  const result = Bun.spawnSync(["docker", ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`docker ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

function buildImage(): string {
  const tag = "burp-smoke:local";
  const buildArgs = Object.entries(fly.build?.args ?? {}).flatMap(([k, v]) => ["--build-arg", `${k}=${v}`]);
  console.log(`Building ${tag} with fly.toml build args...`);
  const result = Bun.spawnSync(
    ["docker", "build", "-f", fly.build?.dockerfile ?? "Dockerfile", ...buildArgs, "-t", tag, "."],
    { cwd: REPO_ROOT, stdout: "inherit", stderr: "inherit" },
  );
  if (!result.success) throw new Error("docker build failed");
  return tag;
}

async function waitHealthy(container: string): Promise<string> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let last = "no response";
  while (Date.now() < deadline) {
    if (docker("inspect", "-f", "{{.State.Running}}", container) !== "true") {
      throw new Error(`container exited during boot (code ${docker("inspect", "-f", "{{.State.ExitCode}}", container)})`);
    }
    // Ephemeral host port: re-resolve on every boot, docker start may assign a new one.
    const port = docker("port", container, String(internalPort)).split("\n")[0].split(":").pop();
    const base = `http://127.0.0.1:${port}`;
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      const body = (await res.json()) as { mcpServers?: Record<string, { status: string; error?: string }> };
      if (res.ok && body.mcpServers?.unified?.status === "running") return base;
      last = `${res.status} ${JSON.stringify(body.mcpServers)}`;
    } catch (error) {
      last = String(error);
    }
    await Bun.sleep(250);
  }
  throw new Error(`not healthy with MCP running within ${BOOT_TIMEOUT_MS}ms (last: ${last})`);
}

async function checkBoot(container: string, label: string): Promise<void> {
  console.log(`\n${label} boot`);
  const started = performance.now();
  const base = await waitHealthy(container);
  check(true, `/health ok with unified MCP running after ${Math.round(performance.now() - started)}ms`);

  const tools = docker("logs", container).match(/mcp_init_complete .*tools_available=(\d+)/g)?.pop();
  check(Number(tools?.match(/tools_available=(\d+)/)?.[1] ?? 0) > 0, "MCP tools registered");

  const index = await fetch(`${base}/`);
  check(index.status === 200 && (await index.text()).includes("/_next/static/"), "GET / serves the Next export");

  const me = await fetch(`${base}/api/users/me`);
  check(me.status === 401, `GET /api/users/me rejects anonymous requests (${me.status})`);

  // Resolve jq exactly as jq-engine does from the bundle's directory.
  const jq = docker("exec", "-w", "/app/server", container, "bun", "-e",
    'const { dirname, join } = require("path");' +
    'const jq = join(dirname(require.resolve("node-jq")), "..", "bin", "jq");' +
    'process.stdout.write(Bun.spawnSync([jq, "-n", "1+1"]).stdout);');
  check(jq === "2", "node-jq's jq binary runs in the image");
}

function checkStop(container: string): void {
  const started = performance.now();
  docker("stop", "-t", String(killTimeoutSec), container);
  const elapsedMs = Math.round(performance.now() - started);
  const exitCode = docker("inspect", "-f", "{{.State.ExitCode}}", container);
  check(exitCode === "0" && elapsedMs < killTimeoutSec * 1000,
    `SIGTERM exits 0 within kill_timeout ${killTimeoutSec}s (code ${exitCode}, ${elapsedMs}ms)`);
}

const imageFlag = process.argv.indexOf("--image");
const image = imageFlag > -1 ? process.argv[imageFlag + 1] : buildImage();
const suffix = `${process.pid}-${Date.now()}`;
const container = `burp-smoke-${suffix}`;
const volume = docker("volume", "create", `burp-smoke-${suffix}`);
let failed = false;

try {
  const env = { ...fly.env, NODE_ENV: "production", CLERK_SECRET_KEY: "sk_test_smoke", LANGFUSE_ENABLED: "false" };
  docker("run", "-d", "--name", container,
    "-p", `127.0.0.1::${internalPort}`,
    "-v", `${volume}:${fly.mounts.destination}`,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    image);

  await checkBoot(container, "Fresh volume");
  checkStop(container);
  // Same container and volume: boots against the already-migrated database.
  docker("start", container);
  await checkBoot(container, "Existing volume");
  checkStop(container);
  console.log("\nImage smoke test passed");
} catch (error) {
  failed = true;
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  console.error("\n--- container logs (tail) ---");
  Bun.spawnSync(["docker", "logs", "--tail", "200", container], { stdout: "inherit", stderr: "inherit" });
} finally {
  Bun.spawnSync(["docker", "rm", "-f", container], { stdout: "ignore", stderr: "ignore" });
  Bun.spawnSync(["docker", "volume", "rm", "-f", volume], { stdout: "ignore", stderr: "ignore" });
}

process.exit(failed ? 1 : 0);
