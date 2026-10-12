/**
 * `bun run eval` arguments. Pure: no server imports, so run.ts can parse them
 * before it points DATABASE_URL at the run's own DB.
 */

export interface RunArgs {
  dataset: string;
  items: string[] | null;
  repeat: number;
  /** Null = the dataset's run_defaults, else 2. */
  concurrency: number | null;
  /** Null = the dataset's run_defaults, else 5. */
  maxCostUsd: number | null;
  note: string | null;
  /** Reproduce a past run: fetch the dataset as of this ISO timestamp, skip the local-hash check. */
  datasetVersion: string | null;
}

export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_MAX_COST_USD = 5;

export const USAGE = `usage: bun run eval --dataset <name> [options]

Runs the agent over a pinned, verified Langfuse dataset as a scored experiment
(plans/eval-pipeline-langfuse-plan.md, Phase 2.1). Each invocation uses its own
DB under app/tmp/evals/.

options:
  --dataset <name>          dataset to run (e.g. smoke, deep)
  --items <id,id,...>       run only these item ids
  --repeat <n>              n linked experiments (…-r1 … -rN) sharing a repeat_group,
                            plus a local per-item variance report (default 1)
  --concurrency <n>         items run in parallel (default: dataset run_defaults, else ${DEFAULT_CONCURRENCY})
  --max-cost-usd <usd>      cost cap shared by all items and repeats (default: dataset
                            run_defaults, else ${DEFAULT_MAX_COST_USD}). Checked before every model call;
                            calls already streaming finish, so the cap can be overshot by
                            about one model call per concurrent item. Items stopped by it
                            are listed as skipped_budget and get no scores.
  --name <note>             appended to the experiment name
  --dataset-version <ts>    reproduce a past run: fetch the dataset as of this ISO timestamp
                            (skips the local YAML check, recorded in run metadata)
  -h, --help                show this help

Model and effort come from app config (LLM_CHAT_MODEL, LLM_EFFORT).`;

export class ArgsError extends Error {}

function positiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ArgsError(`${flag} must be a positive integer, got "${value}"`);
  return n;
}

/** Parses argv (without the script path). Returns null for --help. Throws ArgsError. */
export function parseRunArgs(argv: string[]): RunArgs | null {
  const args: RunArgs = {
    dataset: "",
    items: null,
    repeat: 1,
    concurrency: null,
    maxCostUsd: null,
    note: null,
    datasetVersion: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === "-h" || flag === "--help") return null;
    const [name, inline] = flag.includes("=") ? [flag.slice(0, flag.indexOf("=")), flag.slice(flag.indexOf("=") + 1)] : [flag, undefined];
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "") throw new ArgsError(`${name} needs a value`);
      return v;
    };
    switch (name) {
      case "--dataset":
        args.dataset = value();
        break;
      case "--items":
        args.items = value().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--repeat":
        args.repeat = positiveInt(name, value());
        break;
      case "--concurrency":
        args.concurrency = positiveInt(name, value());
        break;
      case "--max-cost-usd": {
        const v = value();
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) throw new ArgsError(`--max-cost-usd must be a positive number, got "${v}"`);
        args.maxCostUsd = n;
        break;
      }
      case "--name": {
        const v = value();
        if (!/^[A-Za-z0-9._-]+$/.test(v)) throw new ArgsError(`--name may only use letters, digits, ".", "_" and "-"`);
        args.note = v;
        break;
      }
      case "--dataset-version": {
        const v = value();
        if (Number.isNaN(Date.parse(v))) throw new ArgsError(`--dataset-version must be an ISO timestamp, got "${v}"`);
        args.datasetVersion = new Date(v).toISOString();
        break;
      }
      default:
        throw new ArgsError(`unknown argument: ${flag}`);
    }
  }
  if (!args.dataset) throw new ArgsError("--dataset is required");
  return args;
}
