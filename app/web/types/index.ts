import type { FeedbackCategoryId } from "@/lib/feedback-categories";

export interface User {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  image_url: string | null;
  role: "waitlist" | "user" | "admin";
  institution: string | null;
  research_area: string | null;
  total_queries: number;
  created_at: number;
  last_active_at: number | null;
  daily_query_limit?: number | null;
  daily_token_limit?: number | null;
  daily_cost_limit_microusd?: number | null;
  monthly_cost_limit_microusd?: number | null;
}

export interface Session {
  id: string;
  user_id: string;
  title: string | null;
  created_at: number;
  updated_at: number | null;
}

export interface ToolCall {
  id: string;
  name: string;
  server: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  status: "pending" | "running" | "complete" | "error";
}

export interface Feedback {
  value: 0 | 1;
  comment: string | null;
  categories: FeedbackCategoryId[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  createdAt: number;
  tokenUsage?: { input: number; output: number };
  reasoning?: string;
  persisted?: boolean;
  feedback?: Feedback | null;
}

export interface DbMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string | null;
  tool_calls: ToolCall[] | null;
  created_at: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_microusd?: number;
  reasoning?: string | null;
  feedback?: Feedback | null;
}

export interface Tool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  available: boolean;
}

export interface SessionListResponse {
  sessions: Session[];
}

export interface SessionWithMessagesResponse {
  session: Session;
  messages: DbMessage[];
}

export interface ToolListResponse {
  tools: Tool[];
  count: number;
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
    public errorCode?: string
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
  | "usage"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}
