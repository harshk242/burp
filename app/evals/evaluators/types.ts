/**
 * The experiment task's output and the evaluator contract.
 *
 * The task output is built only from persisted rows of the eval DB (chat_turns,
 * messages, model_transcript, usage_events); tool outputs are exactly what the
 * model saw (model_transcript). Evaluators are pure functions of
 * `(taskOutput, item)`, so they are fixture-tested without Langfuse.
 */
import type { DatasetItem } from "../lib/schema";

export interface TaskToolCall {
  /** Tool name as registered (`server__tool`). */
  name: string;
  input: unknown;
  /** The result as the model saw it (after large-output handling), as text. */
  model_output: string;
  /** The result went back to the model as an error. */
  error: boolean;
}

export interface TaskTurn {
  /** 1-based. */
  turn: number;
  user_message: string;
  /** Persisted final answer; null when the turn failed. */
  answer: string | null;
  status: string;
  error_code: string | null;
  final_finish_reason: string | null;
  tool_error_count: number;
  tool_calls: TaskToolCall[];
  cost_usd: number;
  llm_calls: number;
  /** Wall-clock time around the turn's drain (chat_turns timestamps are whole seconds). */
  duration_ms: number;
  trace_id: string | null;
}

export interface TaskOutput {
  /** Dataset item id. */
  item_id: string;
  session_id: string;
  turns: TaskTurn[];
  /** Set when the shared cost budget stopped the item: no evaluator scores it. */
  skipped?: "budget";
}

/** What an evaluator sees of a dataset item. */
export type EvalItem = Pick<DatasetItem, "input" | "expected_output" | "metadata">;

export type ScoreDataType = "NUMERIC" | "BOOLEAN" | "CATEGORICAL";

export interface Evaluation {
  /** Score name (a metric in metrics.yaml). */
  name: string;
  value: number | string;
  dataType: ScoreDataType;
  comment?: string;
  metadata?: Record<string, unknown>;
}

/** Null = not scored (nothing to measure, or a budget-skipped item). */
export type ItemEvaluator = (output: TaskOutput, item: EvalItem) => Evaluation | Evaluation[] | null;
