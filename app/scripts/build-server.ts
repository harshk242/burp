// Bundles the app server into <outRoot>/server/index.js (+ linked sourcemap) for production.
// The bundle must sit at server/index.js relative to the app root: APP_DIR (server/app-dir.ts)
// resolves config.yaml, migrations and relative config paths from the bundle's location.
// Usage: bun scripts/build-server.ts [outRoot]   (default: dist)
import { join, resolve } from "path";

const APP_ROOT = join(import.meta.dir, "..");

// node-jq stays external: jq-engine resolves its jq binary from node_modules on disk.
const SERVER_EXTERNALS = ["node-jq"];

export async function buildServer(outRoot: string): Promise<string> {
  const outdir = join(resolve(outRoot), "server");
  const result = await Bun.build({
    entrypoints: [join(APP_ROOT, "server", "index.ts")],
    outdir,
    naming: "index.js",
    target: "bun",
    minify: true,
    sourcemap: "linked",
    external: SERVER_EXTERNALS,
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "server bundle failed");
  }
  return join(outdir, "index.js");
}

if (import.meta.main) {
  const outfile = await buildServer(process.argv[2] ?? join(APP_ROOT, "dist"));
  console.log(`built ${outfile}`);
}
