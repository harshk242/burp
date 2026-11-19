import { z } from "zod";
import { ALL_CATEGORY_IDS } from "../../shared/feedback-categories";
import type { UsageResponse } from "../../shared/usage";

/**
 * Response schemas for the app API. `useApi` parses each response body with one of these, so the
 * UI gets checked data instead of a cast; the TS types in `@/types` are derived from them.
 */

/** A schema producing `T` from a parsed JSON body. */
export type ResponseSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

const roleSchema = z.enum(["waitlist", "user", "admin"]);

export const userSchema = z.object({
  id: z.string(),
  clerk_id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image_url: z.string().nullable(),
  role: roleSchema,
  institution: z.string().nullable(),
  research_area: z.string().nullable(),
  total_queries: z.number(),
  created_at: z.number(),
  last_active_at: z.number().nullable(),
  daily_query_limit: z.number().nullable().optional(),
  daily_token_limit: z.number().nullable().optional(),
  daily_cost_limit_microusd: z.number().nullable().optional(),
  monthly_cost_limit_microusd: z.number().nullable().optional(),
});

export const sessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  title: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number().nullable(),
});

export const feedbackSchema = z.object({
  value: z.union([z.literal(0), z.literal(1)]),
  comment: z.string().nullable(),
  categories: z.array(z.enum(ALL_CATEGORY_IDS)),
});

/** A tool call as stored with a message (no live `status`; `toolName` is absent on old rows). */
export const dbToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  server: z.string(),
  toolName: z.string().optional(),
  input: z.record(z.unknown()),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

export const dbMessageSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string().nullable(),
  tool_calls: z.array(dbToolCallSchema).nullable(),
  created_at: z.number(),
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cost_microusd: z.number().optional(),
  reasoning: z.string().nullable().optional(),
  feedback: feedbackSchema.nullable().optional(),
});

export const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  server: z.string(),
  inputSchema: z.record(z.unknown()),
  available: z.boolean(),
});

export const sessionListResponseSchema = z.object({ sessions: z.array(sessionSchema) });

export const sessionWithMessagesResponseSchema = z.object({
  session: sessionSchema,
  messages: z.array(dbMessageSchema),
});

export const sessionCreatedResponseSchema = z.object({ id: z.string(), title: z.string() });

export const toolListResponseSchema = z.object({ tools: z.array(toolSchema), count: z.number() });

export const feedbackResponseSchema = z.object({ feedback: feedbackSchema.nullable() });

const tokenUsageSchema = z.object({
  used_today: z.number(),
  limit: z.number(),
  remaining: z.number(),
  input_today: z.number(),
  output_today: z.number(),
});

const costUsageSchema = z.object({
  daily_used_microusd: z.number(),
  daily_limit_microusd: z.number(),
  daily_remaining_microusd: z.number(),
  daily_reset_at: z.number(),
  monthly_used_microusd: z.number(),
  monthly_limit_microusd: z.number(),
  monthly_remaining_microusd: z.number(),
  monthly_reset_at: z.number(),
});

export const usageResponseSchema = z.object({
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  resetAt: z.number(),
  total_queries: z.number(),
  role: roleSchema,
  tokens: tokenUsageSchema,
  cost: costUsageSchema,
}) satisfies ResponseSchema<UsageResponse>;

export const accessRequestSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  institution: z.string().nullable(),
  research_area: z.string().nullable(),
  use_case: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  submitted_at: z.number(),
  reviewed_at: z.number().nullable(),
  reviewed_by: z.string().nullable(),
});

export const accessRequestListResponseSchema = z.object({ requests: z.array(accessRequestSchema) });

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: roleSchema,
  total_queries: z.number(),
  daily_query_limit: z.number().nullable(),
  daily_cost_limit_microusd: z.number().nullable(),
  monthly_cost_limit_microusd: z.number().nullable(),
  created_at: z.number(),
  last_active_at: z.number().nullable(),
  today_queries: z.number(),
  today_input_tokens: z.number(),
  today_output_tokens: z.number(),
  today_cost_microusd: z.number(),
  month_cost_microusd: z.number(),
  effective_limits: z.object({
    daily_query_limit: z.number(),
    daily_cost_limit_microusd: z.number(),
    monthly_cost_limit_microusd: z.number(),
  }),
});

export const adminUserListResponseSchema = z.object({ users: z.array(adminUserSchema) });

export type AccessRequest = z.infer<typeof accessRequestSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;

/** The body parsed with `schema`; a mismatch is an Error naming the endpoint and the first bad field. */
export function parseResponse<T>(schema: ResponseSchema<T>, body: unknown, path: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue ? `${issue.path.join(".") || "(body)"}: ${issue.message}` : "invalid body";
  throw new Error(`Unexpected response from ${path}: ${where}`);
}
