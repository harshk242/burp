/**
 * Shared types for the chat orchestration modules.
 */

export interface StreamEvent {
  type: "start" | "text" | "tool_start" | "tool_end" | "text_block_end" | "done" | "usage" | "error";
  data: unknown;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  server: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
}
