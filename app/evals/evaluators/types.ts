import { z } from "zod";
import type { DatasetItem } from "../lib/schema";

const TaskToolCallSchema = z.object({
  name: z.string(),
  input: z.unknown(),
  model_output: z.string(),
  error: z.boolean(),
});

const TaskTurnSchema = z.object({
  turn: z.number(),
  user_message: z.string(),
  answer: z.string().nullable(),
  status: z.string(),
  error_code: z.string().nullable(),
  final_finish_reason: z.string().nullable(),
  tool_error_count: z.number(),
  tool_calls: z.array(TaskToolCallSchema),
  cost_usd: z.number(),
  llm_calls: z.number(),
  long_context_calls: z.number().optional(),
  duration_ms: z.number(),
  trace_id: z.string().nullable(),
});

/** What the eval task returns per item; the Langfuse SDK hands it back to evaluators untyped. */
export const TaskOutputSchema = z.object({
  item_id: z.string(),
  session_id: z.string(),
  turns: z.array(TaskTurnSchema),
  skipped: z.literal("budget").optional(),
});

export type TaskToolCall = z.infer<typeof TaskToolCallSchema>;
export type TaskTurn = z.infer<typeof TaskTurnSchema>;
export type TaskOutput = z.infer<typeof TaskOutputSchema>;

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
