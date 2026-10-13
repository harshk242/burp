/**
 * Runs the arms of one invocation (plan 2.4): sequentially (items within an
 * arm keep the run's concurrency, so bio-API load is the same per arm), each
 * arm `repeat` times, all on one shared context: the pinned dataset version
 * and one cost budget for the whole matrix. Once the budget is spent the
 * remaining repeats and arms are not started and are reported as
 * `skipped_budget`.
 */

/** What every arm shares. */
export interface MatrixShared<B extends { readonly exhausted: boolean }> {
  datasetVersion: string;
  budget: B;
}

export type ArmStatus =
  /** Every repeat ran (items may still have been budget-skipped inside the last one). */
  | "complete"
  /** Some repeats ran, then the budget ran out. */
  | "partial_budget"
  /** Never started: the budget was spent before it. */
  | "skipped_budget"
  /** The run was stopped (signal) before or during this arm. */
  | "stopped";

export interface ArmRunResult<A, O> {
  arm: A;
  status: ArmStatus;
  outcomes: O[];
}

export interface RunArmsInput<A, O, B extends { readonly exhausted: boolean }> {
  arms: A[];
  repeat: number;
  shared: MatrixShared<B>;
  isStopping: () => boolean;
  runOne: (arm: A, repeatIndex: number, shared: MatrixShared<B>) => Promise<O>;
  log?: (line: string) => void;
}

export async function runArms<A, O, B extends { readonly exhausted: boolean }>(
  input: RunArmsInput<A, O, B>,
): Promise<ArmRunResult<A, O>[]> {
  const results: ArmRunResult<A, O>[] = [];
  for (const arm of input.arms) {
    const outcomes: O[] = [];
    let status: ArmStatus = "complete";
    for (let r = 1; r <= input.repeat; r++) {
      if (input.isStopping()) {
        status = "stopped";
        break;
      }
      if (input.shared.budget.exhausted) {
        status = outcomes.length ? "partial_budget" : "skipped_budget";
        input.log?.(`budget exhausted: skipping ${outcomes.length ? `repeat(s) ${r}..${input.repeat}` : "arm"}`);
        break;
      }
      outcomes.push(await input.runOne(arm, r, input.shared));
    }
    results.push({ arm, status, outcomes });
  }
  return results;
}
