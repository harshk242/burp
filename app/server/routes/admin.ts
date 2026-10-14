import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { userQueries, dailyUsageQueries, rateLimitQueries, usageEventQueries } from "../db";
import { clerkAuth, requireDbUser, requireAdmin } from "../middleware/clerk";
import { ErrorSchema } from "../schemas";
import type { AppEnv } from "../types";
import { IntegerLimitSchema } from "../schemas/limits";
import { resolveEffectiveLimits } from "../usage";

const admin = new OpenAPIHono<AppEnv>();

admin.use("*", clerkAuth, requireDbUser, requireAdmin);

const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.enum(["waitlist", "user", "admin"]),
  total_queries: z.number().int(),
  daily_query_limit: IntegerLimitSchema.nullable(),
  daily_token_limit: IntegerLimitSchema.nullable(),
  daily_cost_limit_microusd: IntegerLimitSchema.nullable(),
  monthly_cost_limit_microusd: IntegerLimitSchema.nullable(),
  created_at: z.number().int(),
  last_active_at: z.number().int().nullable(),
  today_queries: z.number().int(),
  today_input_tokens: z.number().int(),
  today_output_tokens: z.number().int(),
  today_cost_microusd: z.number().int(),
  month_cost_microusd: z.number().int(),
  effective_limits: z.object({
    daily_query_limit: IntegerLimitSchema,
    daily_cost_limit_microusd: IntegerLimitSchema,
    monthly_cost_limit_microusd: IntegerLimitSchema,
  }),
});

const AdminUserListSchema = z.object({
  users: z.array(AdminUserSchema),
});

const limitValue = () => IntegerLimitSchema.nullable();

const PatchLimitsSchema = z.object({
  daily_query_limit: limitValue().optional()
    .openapi({ example: 100, description: "null = role default, -1 = unlimited, >=0 = hard cap" }),
  daily_token_limit: limitValue().optional()
    .openapi({ example: 500000, description: "null = config default, -1 = unlimited, >=0 = reporting threshold" }),
  daily_cost_limit_microusd: limitValue().optional()
    .openapi({ example: 250000, description: "null = config default, -1 = unlimited, >=0 = hard cap in microdollars" }),
  monthly_cost_limit_microusd: limitValue().optional()
    .openapi({ example: 3000000, description: "null = config default, -1 = unlimited, >=0 = hard cap in microdollars" }),
});

const listUsersRoute = createRoute({
  method: "get",
  path: "/users",
  tags: ["Admin"],
  summary: "List all users",
  description: "Returns all users with their current limits and today's usage. Admin only.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "User list",
      content: { "application/json": { schema: AdminUserListSchema } },
    },
    403: {
      description: "Forbidden — admin only",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

admin.openapi(listUsersRoute, (c) => {
  const allUsers = userQueries.listAll();

  const users = allUsers.map((u) => {
    const today = dailyUsageQueries.getTodayFull(u.id);
    const todayCost = usageEventQueries.getTotalsForDate(u.id);
    const monthCost = usageEventQueries.getTotalsForMonth(u.id);
    const limits = resolveEffectiveLimits(u, u.role, rateLimitQueries.getForRole(u.role));
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      total_queries: u.total_queries,
      daily_query_limit: u.daily_query_limit ?? null,
      daily_token_limit: u.daily_token_limit ?? null,
      daily_cost_limit_microusd: u.daily_cost_limit_microusd ?? null,
      monthly_cost_limit_microusd: u.monthly_cost_limit_microusd ?? null,
      created_at: u.created_at,
      last_active_at: u.last_active_at,
      today_queries: today.query_count,
      today_input_tokens: today.input_tokens,
      today_output_tokens: today.output_tokens,
      today_cost_microusd: todayCost.cost_microusd,
      month_cost_microusd: monthCost.cost_microusd,
      effective_limits: {
        daily_query_limit: limits.daily_query_limit,
        daily_cost_limit_microusd: limits.daily_cost_limit_microusd,
        monthly_cost_limit_microusd: limits.monthly_cost_limit_microusd,
      },
    };
  });

  return c.json({ users }, 200);
});

const patchLimitsRoute = createRoute({
  method: "patch",
  path: "/users/{id}/limits",
  tags: ["Admin"],
  summary: "Set per-user rate limit overrides",
  description: "Override query, token, and dollar cost limits for a user. Pass null to clear and revert to defaults. Admin only.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
    body: {
      content: { "application/json": { schema: PatchLimitsSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Limits updated",
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
    403: {
      description: "Forbidden — admin only",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

admin.openapi(patchLimitsRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const user = userQueries.findById(id);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const newQueryLimit = "daily_query_limit" in body ? (body.daily_query_limit ?? null) : user.daily_query_limit ?? null;
  const newTokenLimit = "daily_token_limit" in body ? (body.daily_token_limit ?? null) : user.daily_token_limit ?? null;
  const newDailyCostLimit = "daily_cost_limit_microusd" in body
    ? (body.daily_cost_limit_microusd ?? null)
    : user.daily_cost_limit_microusd ?? null;
  const newMonthlyCostLimit = "monthly_cost_limit_microusd" in body
    ? (body.monthly_cost_limit_microusd ?? null)
    : user.monthly_cost_limit_microusd ?? null;

  userQueries.updateLimits(id, newQueryLimit, newTokenLimit, newDailyCostLimit, newMonthlyCostLimit);

  return c.json({ message: "Limits updated" }, 200);
});

export { admin };
