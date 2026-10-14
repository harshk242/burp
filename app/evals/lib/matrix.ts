export interface MatrixShared<B extends { readonly exhausted: boolean }> {
  datasetVersion: string;
  budget: B;
}

export type ArmStatus =
  /** Every repeat ran every item. */
  | "complete"
  /** The budget ran out inside the arm: items of a repeat were skipped, or later repeats never started. */
  | "partial_budget"
  /** Never started: the budget was spent before it. */
  | "skipped_budget"
  /** The run was stopped (signal) before or during this arm. */
  | "stopped"
  /** Every repeat ran, but some items produced no result (their task threw). */
  | "incomplete";

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
  /**
   * What cut a finished repeat short, if anything: budget-skipped items, items
   * the stop signal left unrun, or items that failed for another reason.
   */
  interruption: (outcome: O) => "budget" | "stopped" | "failed" | null;
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
      const outcome = await input.runOne(arm, r, input.shared);
      outcomes.push(outcome);
      const cut = input.interruption(outcome);
      if (cut === "stopped") {
        status = "stopped";
        break;
      }
      if (cut === "budget") {
        status = "partial_budget";
        if (r < input.repeat) input.log?.(`budget exhausted: skipping repeat(s) ${r + 1}..${input.repeat}`);
        break;
      }
      if (cut === "failed") status = "incomplete";
    }
    results.push({ arm, status, outcomes });
  }
  return results;
}
