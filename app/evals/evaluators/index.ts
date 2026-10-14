import { checkpointRecall } from "./checkpoint-recall";
import { idGrounding } from "./id-grounding";
import { toolCoverage } from "./tool-coverage";
import { turnSignalScores } from "./turn-signals";
import type { EvalItem, Evaluation, ItemEvaluator, TaskOutput } from "./types";

export const ITEM_EVALUATORS: Record<string, ItemEvaluator> = {
  id_grounding: idGrounding,
  checkpoint_recall: checkpointRecall,
  expected_tool_coverage: toolCoverage,
  turn_signals: turnSignalScores,
};

/** Every evaluation for one item; evaluators that return null contribute nothing. */
export function evaluateItem(output: TaskOutput, item: EvalItem): Evaluation[] {
  return Object.values(ITEM_EVALUATORS).flatMap((evaluate) => {
    const result = evaluate(output, item);
    return result === null ? [] : Array.isArray(result) ? result : [result];
  });
}

export type { EvalItem, Evaluation, ItemEvaluator, TaskOutput, TaskToolCall, TaskTurn } from "./types";
