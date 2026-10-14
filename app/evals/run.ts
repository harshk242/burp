import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ArgsError, parseRunArgs, USAGE } from "./lib/args";

const EVAL_ENVIRONMENT = "sdk-experiment";

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseRunArgs(argv);
  } catch (error) {
    if (!(error instanceof ArgsError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (!args) {
    console.log(USAGE);
    return 0;
  }

  const runId = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}-${crypto.randomUUID().slice(0, 8)}`;
  const outDir = join(import.meta.dir, "..", "tmp", "evals");
  mkdirSync(outDir, { recursive: true });
  const dbPath = `app/tmp/evals/${runId}.db`;
  process.env.DATABASE_URL = dbPath;
  process.env.LANGFUSE_TRACING_ENVIRONMENT = EVAL_ENVIRONMENT;
  process.env.LOG_LEVEL ??= "WARN";

  const { runEval } = await import("./lib/runner");
  return runEval(args, { runId, dbPath, outDir });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
