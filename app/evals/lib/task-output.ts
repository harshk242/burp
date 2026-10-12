/**
 * Builds the experiment task output from an item session's persisted rows
 * (plan 2.1 step 3): chat_turns, the user/assistant messages, model_transcript
 * and usage_events. Tool calls and their outputs come from model_transcript, so
 * evaluators see exactly what the model saw. Pure: the runner reads the rows.
 */
import type { TaskOutput, TaskToolCall, TaskTurn } from "../evaluators/types";

/** The chat_turns columns used. */
export interface TurnRow {
  id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  status: string;
  error_code: string | null;
  final_finish_reason: string | null;
  tool_error_count: number;
  trace_id: string | null;
}

export interface TranscriptRow {
  turn_id: string;
  role: string;
  content_json: string;
}

export interface UsageRow {
  turn_id: string | null;
  cost_microusd: number;
  llm_calls: number | null;
}

export interface SessionRows {
  itemId: string;
  sessionId: string;
  /** In turn order. */
  turns: TurnRow[];
  /** Message content by message id. */
  messages: Map<string, string | null>;
  /** In seq order. */
  transcript: TranscriptRow[];
  usage: UsageRow[];
  /** Wall-clock drain time per turn, in turn order. */
  durationsMs: number[];
  /** Transcript tool names → registered names (Gemini sanitizes `-`). */
  toolName?: (name: string) => string;
}

interface Part {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: { type?: string; value?: unknown };
  text?: string;
}

/** A tool result as the text the model saw. */
export function outputText(output: Part["output"]): string {
  if (!output) return "";
  const { type, value } = output;
  if ((type === "text" || type === "error-text") && typeof value === "string") return value;
  if (type === "content" && Array.isArray(value)) {
    return value.map((v: Part) => (v.type === "text" && typeof v.text === "string" ? v.text : JSON.stringify(v))).join("\n");
  }
  return JSON.stringify(value ?? null);
}

function partsOf(row: TranscriptRow): Part[] {
  const message = JSON.parse(row.content_json) as { content?: unknown };
  return Array.isArray(message.content) ? (message.content as Part[]) : [];
}

/** Tool calls of one turn, in call order, joined with their results. */
function toolCallsOf(rows: TranscriptRow[], toolName: (name: string) => string): TaskToolCall[] {
  const calls = new Map<string, TaskToolCall>();
  for (const row of rows) {
    for (const part of partsOf(row)) {
      if (row.role === "assistant" && part.type === "tool-call" && part.toolCallId) {
        calls.set(part.toolCallId, { name: toolName(part.toolName ?? ""), input: part.input ?? null, model_output: "", error: false });
      } else if (row.role === "tool" && part.type === "tool-result" && part.toolCallId) {
        const call = calls.get(part.toolCallId);
        if (!call) continue;
        call.model_output = outputText(part.output);
        call.error = part.output?.type === "error-text" || part.output?.type === "error-json";
      }
    }
  }
  return [...calls.values()];
}

export function buildTaskOutput(rows: SessionRows): TaskOutput {
  const toolName = rows.toolName ?? ((n: string) => n);
  const turns: TaskTurn[] = rows.turns.map((turn, i) => {
    const usage = rows.usage.filter((u) => u.turn_id === turn.id);
    return {
      turn: i + 1,
      user_message: rows.messages.get(turn.user_message_id) ?? "",
      answer: turn.status === "ok" && turn.assistant_message_id ? (rows.messages.get(turn.assistant_message_id) ?? "") : null,
      status: turn.status,
      error_code: turn.error_code,
      final_finish_reason: turn.final_finish_reason,
      tool_error_count: turn.tool_error_count,
      tool_calls: toolCallsOf(rows.transcript.filter((r) => r.turn_id === turn.id), toolName),
      cost_usd: usage.reduce((sum, u) => sum + u.cost_microusd, 0) / 1e6,
      llm_calls: usage.reduce((sum, u) => sum + (u.llm_calls ?? 0), 0),
      duration_ms: Math.round(rows.durationsMs[i] ?? 0),
      trace_id: turn.trace_id,
    };
  });
  const budgetStopped = turns.some((t) => t.error_code === "budget_exceeded");
  return { item_id: rows.itemId, session_id: rows.sessionId, turns, ...(budgetStopped ? { skipped: "budget" as const } : {}) };
}
