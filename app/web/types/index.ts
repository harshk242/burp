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

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  createdAt: number;
}

export interface DbMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string | null;
  tool_calls: ToolCall[] | null;
  created_at: number;
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
    public resetAt: number
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
  | "title"
  | "done"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}
