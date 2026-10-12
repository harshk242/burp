/**
 * Turn signals: the online code scores of a finished turn (`turn_outcome`,
 * `answer_truncated`, `tool_error_count`, see app/evals/metrics.yaml).
 *
 * Computed from the persisted chat_turns row only, so the offline eval runner
 * gets identical values from its own DB without depending on Langfuse
 * ingestion. Writing them to the turn's trace never throws.
 */

import type { LangfuseClient } from "@langfuse/client";
import { logger, type LogContext } from "../logger";
import { getScoreClient, tracingEnvironment } from "./langfuse";

export const TURN_OUTCOMES = [
  "ok",
  "refusal",
  "provider_error",
  "max_tool_iterations",
  "context_budget",
  "no_tools_available",
  "internal_error",
  "aborted",
] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/** The chat_turns columns the signals read. */
export interface TurnSignalRow {
  status: string;
  error_code: string | null;
  final_finish_reason: string | null;
  tool_error_count: number;
}

export interface TurnSignals {
  turn_outcome: TurnOutcome;
  answer_truncated: boolean;
  tool_error_count: number;
}

function outcomeOf(row: TurnSignalRow): TurnOutcome {
  if (row.status === "ok") return "ok";
  // A consumer that stopped reading ("closed") is an abort as far as the turn goes.
  if (row.status === "aborted" || row.error_code === "closed") return "aborted";
  return (TURN_OUTCOMES as readonly string[]).includes(row.error_code ?? "")
    ? (row.error_code as TurnOutcome)
    : "internal_error";
}

export function turnSignals(row: TurnSignalRow): TurnSignals {
  return {
    turn_outcome: outcomeOf(row),
    answer_truncated: row.final_finish_reason === "length",
    tool_error_count: row.tool_error_count,
  };
}

type ScoreSink = Pick<LangfuseClient, "score">;

/**
 * Writes the signals as trace scores in the tracing environment. Score ids are
 * derived from the trace id, so writing a turn's scores twice upserts them.
 * No-op when tracing is off; never throws.
 */
export function writeTurnScores(
  traceId: string,
  signals: TurnSignals,
  ctx: LogContext,
  client: ScoreSink | null = getScoreClient()
): void {
  if (!client) return;
  try {
    const base = { traceId, environment: tracingEnvironment };
    client.score.create({ ...base, id: `${traceId}-turn_outcome`, name: "turn_outcome", value: signals.turn_outcome, dataType: "CATEGORICAL" });
    client.score.create({ ...base, id: `${traceId}-answer_truncated`, name: "answer_truncated", value: signals.answer_truncated ? 1 : 0, dataType: "BOOLEAN" });
    client.score.create({ ...base, id: `${traceId}-tool_error_count`, name: "tool_error_count", value: signals.tool_error_count, dataType: "NUMERIC" });
  } catch (error) {
    logger.warn("TRACE", "turn_scores_failed", { ctx, error: error instanceof Error ? error : String(error) });
  }
}
