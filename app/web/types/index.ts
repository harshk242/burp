import type { z } from "zod";
import type { RateLimitErrorCode } from "../../shared/rate-limit";
import type {
  dbMessageSchema, dbToolCallSchema, feedbackSchema, sessionListResponseSchema, sessionSchema,
  sessionWithMessagesResponseSchema, toolListResponseSchema, toolSchema, userSchema,
} from "@/lib/api-schemas";

export type User = z.infer<typeof userSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type DbToolCall = z.infer<typeof dbToolCallSchema>;
export type DbMessage = z.infer<typeof dbMessageSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type SessionWithMessagesResponse = z.infer<typeof sessionWithMessagesResponseSchema>;
export type ToolListResponse = z.infer<typeof toolListResponseSchema>;

export interface ToolCall {
  id: string;
  name: string;
  server: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string | undefined;
  status: "pending" | "running" | "complete" | "error";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[] | undefined;
  createdAt: number;
  tokenUsage?: { input: number; output: number } | undefined;
  reasoning?: string | undefined;
  persisted?: boolean;
  feedback?: Feedback | null;
}

export interface UserResponse {
  user: User;
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public limit: number,
    public used: number,
    public resetAt: number,
    public errorCode?: RateLimitErrorCode
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export type SSEEventType =
  | "start"
  | "text"
  | "tool_start"
  | "tool_end"
  | "text_block_end"
  | "reasoning"
  | "title"
  | "done"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}
