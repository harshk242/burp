/**
 * Central application configuration.
 *
 * Source priority (highest wins):
 *   1. Environment variables
 *   2. app/config.yaml
 *   3. Built-in defaults (defined in Zod schema)
 *
 * Secrets (API keys, Clerk) are never stored here — they stay in .env.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ── Schema ────────────────────────────────────────────────────────────────────

const PlatformSchema = z.object({
  enabled: z.boolean().default(true),
  always_loaded_tools: z.array(z.string()).default([]),
});

const ArtifactPolicySchema = z.object({
  noise_filters: z.array(z.string()).default([]),
  semantic_profile: z.string().optional(),
});

const ArtifactConfigSchema = z.object({
  inline_max_chars: z.number().int().default(15000),
  hard_cap_bytes: z.number().int().default(1_048_576),
  ttl_minutes: z.number().default(5),
  max_per_session: z.number().int().default(10),
  preview_sample_items: z.number().int().default(2),
  preview_max_chars_per_value: z.number().int().default(150),
  jq_timeout_ms: z.number().int().default(5000),
  jq_max_output_chars: z.number().int().default(50000),
  policies: z
    .object({
      global: ArtifactPolicySchema.default({ noise_filters: ["del(.. | nulls)"] }),
      platforms: z.record(z.string(), ArtifactPolicySchema).default({}),
      tools: z.record(z.string(), ArtifactPolicySchema).default({}),
      profiles: z.record(z.string(), z.array(z.string())).default({}),
    })
    .default({}),
});

const ModelPricingSchema = z.object({
  input_usd_per_mtok: z.number().nonnegative(),
  output_usd_per_mtok: z.number().nonnegative(),
});

const AppConfigSchema = z.object({
  rate_limits: z.object({
    /** Default daily token budget for 'user' role. -1 = unlimited. Admin always unlimited. */
    default_daily_tokens: z.number().int().default(200_000),
  }).default({}),
  usage: z.object({
    /** Default dollar budgets for 'user' role. -1 = unlimited. Admin always unlimited. */
    default_daily_cost_limit_usd: z.number().default(0.25),
    default_monthly_cost_limit_usd: z.number().default(3),
    /** Bounds worst-case overshoot because final usage is only known post-stream. */
    max_chat_input_chars: z.number().int().positive().default(20_000),
    pricing: z.record(z.string(), z.record(z.string(), ModelPricingSchema)).default({
      anthropic: {
        "claude-haiku-4-5": {
          input_usd_per_mtok: 1,
          output_usd_per_mtok: 5,
        },
      },
      google: {
        "gemini-3-flash-preview": {
          input_usd_per_mtok: 0.5,
          output_usd_per_mtok: 3,
        },
      },
    }),
  }).default({}),
  llm: z.object({
    provider: z.enum(["anthropic", "google"]).default("anthropic"),
    chat_model: z.string().default("claude-haiku-4-5"),
    title_model: z.string().default("claude-haiku-4-5"),
    max_retries: z.number().int().default(3),
    max_output_tokens: z.number().int().positive().default(4096),
    max_tool_iterations: z.number().int().positive().default(6),
  }),
  server: z.object({
    port: z.number().int().default(3000),
    database_url: z.string().default("./data/burp.db"),
    mcp_servers_base: z.string().default("../mcp-server"),
    cors_origins: z.array(z.string()).default(["http://localhost:3000", "http://localhost:3001"]),
    log_dir: z.string().default("../logs"),
    log_level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("DEBUG"),
  }),
  tool_search: z.object({
    bm25_weight: z.number().default(1.0),
    semantic_weight: z.number().default(1.0),
    short_query_threshold: z.number().int().default(4),
    short_query_bm25_weight: z.number().default(2.0),
    top_k: z.number().int().default(15),
  }),
  platforms: z.record(z.string(), PlatformSchema).default({}),
  artifact: ArtifactConfigSchema.default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type PlatformConfig = z.infer<typeof PlatformSchema>;

// ── Loader ────────────────────────────────────────────────────────────────────

function loadYamlFile(): Record<string, unknown> {
  try {
    const configPath = join(process.cwd(), "config.yaml");
    const raw = readFileSync(configPath, "utf-8");
    return (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function applyEnvOverrides(cfg: AppConfig): AppConfig {
  const e = process.env;

  // LLM
  if (e.LLM_PROVIDER) cfg.llm.provider = e.LLM_PROVIDER as AppConfig["llm"]["provider"];
  if (e.LLM_CHAT_MODEL || e.CLAUDE_MODEL) cfg.llm.chat_model = (e.LLM_CHAT_MODEL || e.CLAUDE_MODEL)!;
  if (e.LLM_TITLE_MODEL || e.CLAUDE_TITLE_MODEL) cfg.llm.title_model = (e.LLM_TITLE_MODEL || e.CLAUDE_TITLE_MODEL)!;
  if (e.LLM_MAX_RETRIES) cfg.llm.max_retries = parseInt(e.LLM_MAX_RETRIES, 10);
  if (e.LLM_MAX_OUTPUT_TOKENS) cfg.llm.max_output_tokens = parseInt(e.LLM_MAX_OUTPUT_TOKENS, 10);
  if (e.LLM_MAX_TOOL_ITERATIONS) cfg.llm.max_tool_iterations = parseInt(e.LLM_MAX_TOOL_ITERATIONS, 10);

  // Usage / cost limits
  if (e.DEFAULT_DAILY_COST_LIMIT_USD) cfg.usage.default_daily_cost_limit_usd = parseFloat(e.DEFAULT_DAILY_COST_LIMIT_USD);
  if (e.DEFAULT_MONTHLY_COST_LIMIT_USD) cfg.usage.default_monthly_cost_limit_usd = parseFloat(e.DEFAULT_MONTHLY_COST_LIMIT_USD);
  if (e.MAX_CHAT_INPUT_CHARS) cfg.usage.max_chat_input_chars = parseInt(e.MAX_CHAT_INPUT_CHARS, 10);

  // Server
  if (e.PORT) cfg.server.port = parseInt(e.PORT, 10);
  if (e.DATABASE_URL) cfg.server.database_url = e.DATABASE_URL;
  if (e.MCP_SERVERS_BASE) cfg.server.mcp_servers_base = e.MCP_SERVERS_BASE;
  if (e.CORS_ORIGINS) cfg.server.cors_origins = e.CORS_ORIGINS.split(",").map((o) => o.trim());
  if (e.LOG_DIR) cfg.server.log_dir = e.LOG_DIR;
  if (e.LOG_LEVEL) cfg.server.log_level = e.LOG_LEVEL as AppConfig["server"]["log_level"];

  // Tool search
  if (e.TOOL_SEARCH_BM25_WEIGHT) cfg.tool_search.bm25_weight = parseFloat(e.TOOL_SEARCH_BM25_WEIGHT);
  if (e.TOOL_SEARCH_SEMANTIC_WEIGHT) cfg.tool_search.semantic_weight = parseFloat(e.TOOL_SEARCH_SEMANTIC_WEIGHT);
  if (e.TOOL_SEARCH_SHORT_QUERY_THRESHOLD) cfg.tool_search.short_query_threshold = parseInt(e.TOOL_SEARCH_SHORT_QUERY_THRESHOLD, 10);
  if (e.TOOL_SEARCH_SHORT_QUERY_BM25_WEIGHT) cfg.tool_search.short_query_bm25_weight = parseFloat(e.TOOL_SEARCH_SHORT_QUERY_BM25_WEIGHT);
  if (e.TOOL_SEARCH_TOP_K) cfg.tool_search.top_k = parseInt(e.TOOL_SEARCH_TOP_K, 10);

  return cfg;
}

function loadConfig(): AppConfig {
  const raw = loadYamlFile();
  const parsed = AppConfigSchema.parse(raw);
  return applyEnvOverrides(parsed);
}

export const appConfig: AppConfig = loadConfig();
