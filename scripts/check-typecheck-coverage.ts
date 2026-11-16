// Fails when a TS/JS source file (tracked, or untracked and not ignored) is not part of any tsconfig program, so new files
// (or new top-level folders) cannot silently escape type checking.
// Usage: bun scripts/check-typecheck-coverage.ts
import { existsSync } from "fs";
import { join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const TSC = join(REPO_ROOT, "node_modules", ".bin", "tsc");

const TSCONFIGS = [
  "tsconfig.json",
  "mcp-server/tsconfig.json",
  "mcp-server/tsconfig.scripts.json",
  "app/tsconfig.json",
  "app/web/tsconfig.json",
];

const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];

function run(cmd: string[]): string {
  const result = Bun.spawnSync(cmd, { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    throw new Error(`${cmd.join(" ")} failed:\n${result.stdout.toString()}${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean);

const tracked = lines(run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", ...SOURCE_GLOBS]))
  .filter((file) => existsSync(join(REPO_ROOT, file)));
const covered = new Set<string>();
for (const config of TSCONFIGS) {
  for (const file of lines(run([TSC, "-p", config, "--listFilesOnly"]))) {
    covered.add(relative(REPO_ROOT, file));
  }
}

const uncovered = tracked.filter((file) => !covered.has(file));
if (uncovered.length > 0) {
  console.error(`${uncovered.length} source file(s) are not type-checked by any tsconfig:`);
  for (const file of uncovered) console.error(`  ${file}`);
  console.error(`Add them to the "include" of one of: ${TSCONFIGS.join(", ")}`);
  process.exit(1);
}
console.log(`Type-check coverage OK: ${tracked.length} source files across ${TSCONFIGS.length} tsconfigs.`);
