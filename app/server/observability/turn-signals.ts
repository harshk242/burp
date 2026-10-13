/**
 * Turn signals: the online code scores of a finished turn (`turn_outcome`,
 * `answer_truncated`, `tool_error_count`, see app/evals/metrics.yaml).
 *
 * Computed from the persisted chat_turns row only, so the offline eval runner
 * gets identical values from its own DB without depending on Langfuse
 * ingestion. Writing them to the turn's trace never throws.
 *
 * A turn stopped by a shared cost budget (`budget_exceeded`, eval runner) has
 * no signals: it says nothing about the agent, so it is never scored.
 */

import type { LangfuseClient } from "@langfuse/client";
import { logger, type LogContext } from "../logger";
import { getScoreClient, tracingEnvironment } from "./langfuse";
import { scoreConfigId } from "./score-configs";

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

/** Null for budget-stopped turns (never scored). */
export function turnSignals(row: TurnSignalRow): TurnSignals | null {
  if (row.error_code === "budget_exceeded") return null;
  return {
    turn_outcome: outcomeOf(row),
    answer_truncated: row.final_finish_reason === "length",
    tool_error_count: row.tool_error_count,
  };
}

type ScoreSink = Pick<LangfuseClient, "score">;

/** Where a turn's scores go: its trace, or its root observation when the turn is nested in a larger trace. */
export interface ScoreTarget {
  traceId: string;
  observationId?: string | null;
}

/**
 * Writes the signals as scores in the tracing environment, each referencing its
 * score config. Score ids are derived from the target, so writing a turn's
 * scores twice upserts them. No-op when tracing is off; never throws.
 */
export function writeTurnScores(
  target: ScoreTarget,
  signals: TurnSignals,
  ctx: LogContext,
  client: ScoreSink | null = getScoreClient()
): void {
  if (!client) return;
  try {
    const { traceId, observationId } = target;
    const prefix = observationId ? `${traceId}-${observationId}` : traceId;
    const values: [keyof TurnSignals, string | number, "CATEGORICAL" | "BOOLEAN" | "NUMERIC"][] = [
      ["turn_outcome", signals.turn_outcome, "CATEGORICAL"],
      ["answer_truncated", signals.answer_truncated ? 1 : 0, "BOOLEAN"],
      ["tool_error_count", signals.tool_error_count, "NUMERIC"],
    ];
    for (const [name, value, dataType] of values) {
      client.score.create({
        traceId,
        ...(observationId ? { observationId } : {}),
        environment: tracingEnvironment,
        id: `${prefix}-${name}`,
        name,
        value,
        dataType,
        configId: scoreConfigId(name),
      });
    }
  } catch (error) {
    logger.warn("TRACE", "turn_scores_failed", { ctx, error: error instanceof Error ? error : String(error) });
  }
}
