import type { DbMessage, Message, ToolCall } from "@/types";

/** Converts a session-history message from the API to the frontend format. */
export function dbMessageToMessage(msg: DbMessage): Message {
  const tokenUsage =
    msg.role === "assistant" && (msg.input_tokens ?? 0) + (msg.output_tokens ?? 0) > 0
      ? { input: msg.input_tokens ?? 0, output: msg.output_tokens ?? 0 }
      : undefined;
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content || "",
    toolCalls: msg.tool_calls as ToolCall[] | undefined,
    createdAt: msg.created_at * 1000,
    tokenUsage,
    // Load reasoning from DB column (null/undefined → omit field)
    reasoning: msg.reasoning || undefined,
    persisted: true,
    // The user's rating, comment and categories, as saved
    feedback: msg.feedback ?? null,
  };
}
