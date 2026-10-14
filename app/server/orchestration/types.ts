export interface ChatCompletion {
  messageId: string;
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent = { type: "done"; data: ChatCompletion } | {
  type: "start" | "text" | "tool_start" | "tool_end" | "text_block_end" | "reasoning" | "error";
  data: unknown;
};

export interface ToolCallRecord {
  id: string;
  name: string;
  server: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
}
