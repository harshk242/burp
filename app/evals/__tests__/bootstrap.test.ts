import { expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appDir = `${import.meta.dir}/../..`;

function probe(script: string) {
  const result = Bun.spawnSync(["bun", "--eval", script], {
    cwd: appDir,
    env: { ...process.env, DATABASE_URL: ":memory:", LOG_DIR: "/tmp/medium-logs-m7" },
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

it("opens the server database at the run path when bootstrapped first", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "eval-bootstrap-")), "run.db");
  const result = probe(`
    const { initializeRunDependencies } = await import("./evals/lib/bootstrap");
    const deps = await initializeRunDependencies(${JSON.stringify(dbPath)});
    const server = await import("./server/db/client");
    if (server.sqlite !== deps.sqlite) throw new Error("run uses a different connection than the server modules");
    console.log(deps.dbPath, server.DB_PATH, deps.sqlite.filename);
  `);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).toBe(`${dbPath} ${dbPath} ${dbPath}`);
});

it("refuses to run when the server database was opened before the bootstrap", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "eval-bootstrap-")), "run.db");
  const result = probe(`
    await import("./server/db/client");
    const { initializeRunDependencies, RunBootstrapError } = await import("./evals/lib/bootstrap");
    try {
      await initializeRunDependencies(${JSON.stringify(dbPath)});
      console.log("opened");
    } catch (error) {
      console.log(error instanceof RunBootstrapError ? "refused" : String(error));
    }
  `);
  expect(result.stdout.trim()).toBe("refused");
});
