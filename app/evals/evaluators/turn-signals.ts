/**
 * The online turn signals (server/observability/turn-signals.ts) as item-level
 * offline scores, computed from the same persisted chat_turns columns:
 *   - turn_outcome: the first non-ok turn's outcome, else `ok`
 *   - answer_truncated: any turn's final call ended with `length`
 *   - tool_error_count: summed over the turns
 * The server module is the single source of the per-turn values; this only
 * pools them. Budget-skipped items are not scored.
 */
import { turnSignals, type TurnSignals } from "../../server/observability/turn-signals";
import type { Evaluation, ItemEvaluator } from "./types";

export const turnSignalScores: ItemEvaluator = (output) => {
  if (output.skipped || output.turns.length === 0) return null;
  const perTurn: { turn: number; signals: TurnSignals }[] = [];
  for (const t of output.turns) {
    const signals = turnSignals({
      status: t.status,
      error_code: t.error_code,
      final_finish_reason: t.final_finish_reason,
      tool_error_count: t.tool_error_count,
    });
    if (!signals) return null;
    perTurn.push({ turn: t.turn, signals });
  }
  const firstFailure = perTurn.find((p) => p.signals.turn_outcome !== "ok");
  const truncated = perTurn.filter((p) => p.signals.answer_truncated).map((p) => p.turn);
  const toolErrors = perTurn.reduce((n, p) => n + p.signals.tool_error_count, 0);
  const evaluations: Evaluation[] = [
    {
      name: "turn_outcome",
      value: firstFailure?.signals.turn_outcome ?? "ok",
      dataType: "CATEGORICAL",
      comment: firstFailure ? `turn ${firstFailure.turn}: ${firstFailure.signals.turn_outcome}` : `${perTurn.length} turn(s) ok`,
    },
    {
      name: "answer_truncated",
      value: truncated.length > 0 ? 1 : 0,
      dataType: "BOOLEAN",
      ...(truncated.length ? { comment: `truncated turn(s): ${truncated.join(", ")}` } : {}),
    },
    { name: "tool_error_count", value: toolErrors, dataType: "NUMERIC" },
  ];
  return evaluations;
};
