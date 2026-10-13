import type { FeedbackCategoryId } from "@/lib/feedback-categories";

// ============================================
// User Types
// ============================================

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

// ============================================
// Session Types
// ============================================

export interface Session {
  id: string;
  user_id: string;
  title: string | null;
  created_at: number;
  updated_at: number | null;
}

// ============================================
// Message Types
// ============================================

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

/** 👍 = 1, 👎 = 0 on an assistant message (the current user's) */
export interface Feedback {
  value: 0 | 1;
  comment: string | null;
  /** Selected category ids of the rating's polarity (lib/feedback-categories), sorted; [] when none */
  categories: FeedbackCategoryId[];
}

export interface Message {
  /** Server message id when `persisted`, else a client-only id */
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  createdAt: number;
  /** Token counts — set from the usage SSE event or loaded from history */
  tokenUsage?: { input: number; output: number };
  /** Pre-tool-call reasoning text (separate from final response) */
  reasoning?: string;
  /** Saved on the server under `id` (loaded from history or confirmed by the done event); feedback needs it */
  persisted?: boolean;
  /** The user's feedback (assistant messages) */
  feedback?: Feedback | null;
}

export interface DbMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string | null;
  tool_calls: ToolCall[] | null;
  created_at: number;
  /** Token counts stored with the assistant message (0 for user messages) */
  input_tokens?: number;
  output_tokens?: number;
  /** Main chat model cost stored in microdollars */
  cost_microusd?: number;
  /** Pre-tool-call reasoning text stored separately to avoid model context contamination */
  reasoning?: string | null;
  /** The current user's feedback (assistant messages only) */
  feedback?: Feedback | null;
}

// ============================================
// Tool Types
// ============================================

export interface Tool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  available: boolean;
}

// ============================================
// API Response Types
// ============================================

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

// ============================================
// Rate Limit Types
// ============================================

export class RateLimitError extends Error {
  constructor(
    message: string,
    public limit: number,
    public used: number,
    public resetAt: number,
    /** "query_limit_exceeded" | "token_limit_exceeded" | "cost_limit_exceeded" */
    public errorCode?: string
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

// ============================================
// SSE Event Types
// ============================================

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
