/**
 * `bun run eval` arguments. Pure: no server imports, so run.ts can parse them
 * before it points DATABASE_URL at the run's own DB.
 */
import { ArmsError, parseArmFlag, type ArmSpec } from "./arms";

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
  /** `--matrix <name>`: arms from app/evals/matrices/<name>.yaml. */
  matrix: string | null;
  /** `--arm` arms, in flag order (after the matrix arms). None and no matrix = production config. */
  arms: ArmSpec[];
}

export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_MAX_COST_USD = 5;

export const USAGE = `usage: bun run eval --dataset <name> [options]

Runs the agent over a pinned, verified Langfuse dataset as a scored experiment
(plans/eval-pipeline-langfuse-plan.md, Phase 2.1). Each invocation uses its own
DB under app/tmp/evals/.

Arms (Phase 2.4): with --matrix and/or --arm, every arm (model + effort) runs as
its own experiment on the same pinned dataset version, one arm after another,
linked by a comparison_group; a comparison report goes to
app/tmp/evals/<comparison_group>.{json,md}. Without them the run uses app config
(LLM_CHAT_MODEL, LLM_EFFORT, LLM_MAX_OUTPUT_TOKENS).

options:
  --dataset <name>          dataset to run (e.g. smoke, deep)
  --items <id,id,...>       run only these item ids
  --matrix <name>           arms from app/evals/matrices/<name>.yaml (e.g. sonnet-effort)
  --arm <model>:<effort>[:<max_output_tokens>]
                            add an arm (repeatable), e.g. --arm claude-sonnet-5-5:high.
                            Effort: low | medium | high | xhigh | max. Arms without
                            max_output_tokens get 64000 (capped at the model's limit);
                            max_context_tokens is app config for every arm. Each arm's
                            model and effort are checked against the Anthropic Models API
                            and its pricing before anything runs.
  --repeat <n>              n linked experiments (…-r1 … -rN) per arm sharing a repeat_group,
                            plus a local per-item variance report (default 1)
  --concurrency <n>         items run in parallel (default: dataset run_defaults, else ${DEFAULT_CONCURRENCY})
  --max-cost-usd <usd>      cost cap shared by all arms, items and repeats (default: dataset
                            run_defaults, else ${DEFAULT_MAX_COST_USD}). Checked before every model call;
                            calls already streaming finish, so the cap can be overshot by
                            about one model call per concurrent item. Items stopped by it
                            are listed as skipped_budget and get no scores; arms not
                            started once it is spent are reported as skipped_budget.
                            A rough per-arm estimate is printed before the run.
  --name <note>             appended to the experiment name
  --dataset-version <ts>    reproduce a past run: fetch the dataset as of this ISO timestamp
                            (skips the local YAML check, recorded in run metadata)
  -h, --help                show this help`;

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
    matrix: null,
    arms: [],
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
      case "--matrix": {
        const v = value();
        if (!/^[A-Za-z0-9._-]+$/.test(v)) throw new ArgsError(`--matrix takes a matrix name (app/evals/matrices/<name>.yaml), got "${v}"`);
        args.matrix = v;
        break;
      }
      case "--arm":
        try {
          args.arms.push(parseArmFlag(value()));
        } catch (error) {
          if (error instanceof ArmsError) throw new ArgsError(error.message);
          throw error;
        }
        break;
      default:
        throw new ArgsError(`unknown argument: ${flag}`);
    }
  }
  if (!args.dataset) throw new ArgsError("--dataset is required");
  return args;
}
