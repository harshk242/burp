import { z } from "@hono/zod-openapi";

// ============================================
// Common Schemas
// ============================================

export const ErrorSchema = z.object({
  error: z.string().openapi({ example: "Error message" }),
});

export const MessageSchema = z.object({
  message: z.string().openapi({ example: "Success message" }),
});

// ============================================
// User Schemas
// ============================================

export const UserSchema = z.object({
  id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
  clerk_id: z.string().openapi({ example: "user_2abc123" }),
  email: z.string().email().openapi({ example: "user@example.com" }),
  name: z.string().nullable().openapi({ example: "John Doe" }),
  image_url: z.string().url().nullable().openapi({ example: "https://example.com/avatar.jpg" }),
  role: z.enum(["waitlist", "user", "admin"]).openapi({ example: "user" }),
  institution: z.string().nullable().openapi({ example: "MIT" }),
  research_area: z.string().nullable().openapi({ example: "Computational Biology" }),
  total_queries: z.number().int().openapi({ example: 42 }),
  created_at: z.number().int().openapi({ example: 1706371200 }),
  last_active_at: z.number().int().nullable().openapi({ example: 1706371200 }),
  // Per-user rate limit overrides (NULL = use role/config default)
  daily_query_limit: z.number().int().nullable().optional().openapi({ example: null, description: "NULL = use role default" }),
  daily_token_limit: z.number().int().nullable().optional().openapi({ example: null, description: "NULL = use config default" }),
  daily_cost_limit_microusd: z.number().int().nullable().optional().openapi({ example: null, description: "NULL = use config default, -1 = unlimited" }),
  monthly_cost_limit_microusd: z.number().int().nullable().optional().openapi({ example: null, description: "NULL = use config default, -1 = unlimited" }),
});

// ============================================
// Access Request / Waitlist Schemas
// ============================================

export const AccessRequestSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  institution: z.string().nullable(),
  research_area: z.string().nullable(),
  use_case: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  submitted_at: z.number().int(),
  reviewed_at: z.number().int().nullable(),
  reviewed_by: z.string().uuid().nullable(),
});

export const CreateAccessRequestSchema = z.object({
  email: z.string().email().openapi({ example: "researcher@university.edu" }),
  name: z.string().min(1).openapi({ example: "Jane Doe" }),
  institution: z.string().optional().openapi({ example: "Stanford University" }),
  research_area: z.string().optional().openapi({ example: "Drug Discovery" }),
  use_case: z.string().optional().openapi({ example: "I need to query protein-drug interactions for my PhD research" }),
});

export const AccessRequestCreatedSchema = z.object({
  message: z.string().openapi({ example: "Access request submitted" }),
  id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
});

export const AccessRequestListSchema = z.object({
  requests: z.array(AccessRequestSchema),
});

// ============================================
// Chat Session Schemas
// ============================================

export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int().nullable(),
});

export const CreateSessionSchema = z.object({
  title: z.string().optional().openapi({ example: "BRCA1 Research" }),
});

export const SessionCreatedSchema = z.object({
  id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
  title: z.string().openapi({ example: "New Chat" }),
});

export const UpdateSessionSchema = z.object({
  title: z.string().min(1).openapi({ example: "Updated Title" }),
});

export const SessionListSchema = z.object({
  sessions: z.array(ChatSessionSchema),
});

// ============================================
// Message Schemas
// ============================================

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  server: z.string(),
  input: z.record(z.unknown()),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

export const MessageSchema2 = z.object({
  id: z.string().uuid(),
  chat_id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).nullable(),
  created_at: z.number().int(),
  // Token counts — 0 for user messages and rows predating the migration
  input_tokens: z.number().int().default(0).openapi({ example: 150 }),
  output_tokens: z.number().int().default(0).openapi({ example: 300 }),
  // Pre-tool-call reasoning text, stored separately to keep model context clean
  reasoning: z.string().nullable().default(null).openapi({ example: null }),
  // Main chat model cost charged for this assistant response
  cost_microusd: z.number().int().default(0).openapi({ example: 1200 }),
});

export const UsageEventSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  date: z.string(),
  month: z.string(),
  operation: z.literal("chat"),
  provider: z.string(),
  model: z.string(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_tokens: z.number().int(),
  cache_write_5m_tokens: z.number().int(),
  cache_write_1h_tokens: z.number().int(),
  input_cost_per_mtok_microusd: z.number().int(),
  output_cost_per_mtok_microusd: z.number().int(),
  pricing_json: z.string().nullable(),
  cost_microusd: z.number().int(),
  input_cost_microusd: z.number().int(),
  cache_read_cost_microusd: z.number().int(),
  cache_write_cost_microusd: z.number().int(),
  output_cost_microusd: z.number().int(),
  llm_calls: z.number().int().nullable(),
  long_context_calls: z.number().int(),
  status: z.enum(["ok", "error"]),
  usage_estimated: z.number().int(),
  session_id: z.string().uuid().nullable(),
  message_id: z.string().uuid().nullable(),
  turn_id: z.string().uuid().nullable(),
  created_at: z.number().int(),
});

export const SessionWithMessagesSchema = z.object({
  session: ChatSessionSchema,
  messages: z.array(MessageSchema2),
});

// ============================================
// Chat Schemas
// ============================================

export const ChatRequestSchema = z.object({
  message: z.string().min(1).openapi({ example: "What are the known drugs targeting EGFR?" }),
  sessionId: z.string().uuid().optional().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
});

// ============================================
// Tool Schemas
// ============================================

export const MCPToolSchema = z.object({
  name: z.string().openapi({ example: "search_proteins" }),
  description: z.string().openapi({ example: "Search for proteins by name, gene, or accession" }),
  server: z.string().openapi({ example: "uniprot" }),
  inputSchema: z.record(z.unknown()),
  available: z.boolean().openapi({ example: true, description: "Whether the MCP server is available" }),
});

export const ToolListSchema = z.object({
  tools: z.array(MCPToolSchema),
  count: z.number().int().optional(),
});

export const ToolSearchQuerySchema = z.object({
  q: z.string().openapi({ example: "protein search" }),
});

// ============================================
// Usage / Rate Limit Schemas
// ============================================

export const UsageSchema = z.object({
  used: z.number().int().openapi({ example: 12 }),
  limit: z.number().int().openapi({ example: 50, description: "-1 means unlimited" }),
  remaining: z.number().int().openapi({ example: 38 }),
  resetAt: z.number().int().openapi({ example: 1711497600, description: "Unix timestamp of next midnight UTC" }),
  total_queries: z.number().int().openapi({ example: 142 }),
  role: z.enum(["waitlist", "user", "admin"]).openapi({ example: "user" }),
  tokens: z.object({
    used_today: z.number().int().openapi({ example: 12400 }),
    limit: z.number().int().openapi({ example: 200000, description: "-1 means unlimited" }),
    remaining: z.number().int().openapi({ example: 187600, description: "-1 means unlimited" }),
    input_today: z.number().int().openapi({ example: 8200 }),
    output_today: z.number().int().openapi({ example: 4200 }),
  }).openapi({ description: "Daily token budget" }),
  cost: z.object({
    daily_used_microusd: z.number().int().openapi({ example: 12000 }),
    daily_limit_microusd: z.number().int().openapi({ example: 250000, description: "-1 means unlimited" }),
    daily_remaining_microusd: z.number().int().openapi({ example: 238000, description: "-1 means unlimited" }),
    daily_reset_at: z.number().int().openapi({ example: 1711497600 }),
    monthly_used_microusd: z.number().int().openapi({ example: 45000 }),
    monthly_limit_microusd: z.number().int().openapi({ example: 3000000, description: "-1 means unlimited" }),
    monthly_remaining_microusd: z.number().int().openapi({ example: 2955000, description: "-1 means unlimited" }),
    monthly_reset_at: z.number().int().openapi({ example: 1711929600 }),
  }).openapi({ description: "Daily and monthly dollar budgets in microdollars" }),
});

export const AccessRequestAllListSchema = z.object({
  requests: z.array(AccessRequestSchema),
});

// ============================================
// Health Check Schemas
// ============================================

export const HealthSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
  version: z.string(),
  mcpServers: z.record(z.object({
    status: z.string(),
    error: z.string().optional(),
  })),
});
