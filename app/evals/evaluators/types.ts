import type { DatasetItem } from "../lib/schema";

export interface TaskToolCall {
  name: string;
  input: unknown;
  model_output: string;
  error: boolean;
}

export interface TaskTurn {
  turn: number;
  user_message: string;
  answer: string | null;
  status: string;
  error_code: string | null;
  final_finish_reason: string | null;
  tool_error_count: number;
  tool_calls: TaskToolCall[];
  cost_usd: number;
  llm_calls: number;
  long_context_calls?: number;
  duration_ms: number;
  trace_id: string | null;
}

export interface TaskOutput {
  item_id: string;
  session_id: string;
  turns: TaskTurn[];
  skipped?: "budget";
}

export type EvalItem = Pick<DatasetItem, "input" | "expected_output" | "metadata">;

export type ScoreDataType = "NUMERIC" | "BOOLEAN" | "CATEGORICAL";

export interface Evaluation {
  name: string;
  value: number | string;
  dataType: ScoreDataType;
  comment?: string;
  metadata?: Record<string, unknown>;
}

export type ItemEvaluator = (output: TaskOutput, item: EvalItem) => Evaluation | Evaluation[] | null;
