import type { DbMessage, DbToolCall, Message, ToolCall } from "@/types";

/** A stored tool call as the UI shows it: finished, so complete unless it recorded an error. */
function toToolCall(call: DbToolCall): ToolCall {
  return {
    id: call.id,
    name: call.name,
    server: call.server,
    toolName: call.toolName ?? call.name,
    input: call.input,
    output: call.output,
    error: call.error,
    status: call.error ? "error" : "complete",
  };
}

export function dbMessageToMessage(msg: DbMessage): Message {
  const tokenUsage =
    msg.role === "assistant" && (msg.input_tokens ?? 0) + (msg.output_tokens ?? 0) > 0
      ? { input: msg.input_tokens ?? 0, output: msg.output_tokens ?? 0 }
      : undefined;
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content || "",
    toolCalls: msg.tool_calls?.map(toToolCall),
    createdAt: msg.created_at * 1000,
    tokenUsage,
    reasoning: msg.reasoning || undefined,
    persisted: true,
    feedback: msg.feedback ?? null,
  };
}
