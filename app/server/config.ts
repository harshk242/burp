import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { EMBEDDING_PROVIDERS } from "./embeddings/types";

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
  db_ttl_hours: z.number().default(24),
  max_session_bytes: z.number().int().default(20_971_520),
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

function usdPerMtok() {
  return z
    .number()
    .nonnegative()
    .refine((usd) => Math.abs(usd * 1e6 - Math.round(usd * 1e6)) < 1e-6, {
      message: "must be a whole number of µUSD per MTok (at most 6 decimal places)",
    });
}

const RateSetSchema = z.object({
  input_usd_per_mtok: usdPerMtok(),
  output_usd_per_mtok: usdPerMtok(),
  cache_read_usd_per_mtok: usdPerMtok().optional(),
  cache_write_5m_usd_per_mtok: usdPerMtok().optional(),
  cache_write_1h_usd_per_mtok: usdPerMtok().optional(),
});

const LongContextSchema = RateSetSchema.required().extend({
  above_input_tokens: z.number().int().positive(),
});

const ModelPricingSchema = RateSetSchema.extend({
  long_context: LongContextSchema.optional(),
});

const EmbeddingConfigSchema = z.object({
  provider: z.enum(EMBEDDING_PROVIDERS).default("openai"),
  model: z.string().min(1).default("text-embedding-3-small"),
  /** Output size; omit for the model's native size. Part of the embedder identity. */
  dimensions: z.number().int().positive().optional(),
  /** The semantic half of search falls back to keyword results after this. */
  query_timeout_ms: z.number().int().positive().default(2000),
  /** Keep the index in sync in the background at boot and when the tool set changes. */
  sync_on_boot: z.boolean().default(true),
  /** Deadline for the embedding call of one sync attempt. */
  sync_timeout_ms: z.number().int().positive().default(120_000),
});

const LangfuseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Langfuse environment of traces and scores (dev | prod; eval runs set their own). */
  environment: z.string().min(1).default("dev"),
  /** Generations carry the full replayed context instead of the delta (debugging only). */
  full_generation_input: z.boolean().default(false),
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
    max_chat_input_chars: z.number().int().positive().default(20_000),
    pricing: z.record(z.string(), z.record(z.string(), ModelPricingSchema)).default({
      anthropic: {
        "claude-sonnet-5-5": {
          input_usd_per_mtok: 2,
          output_usd_per_mtok: 10,
          cache_read_usd_per_mtok: 0.1,
          cache_write_5m_usd_per_mtok: 2.5,
          cache_write_1h_usd_per_mtok: 4,
        },
        "claude-haiku-4-5": {
          input_usd_per_mtok: 1,
          output_usd_per_mtok: 5,
          cache_read_usd_per_mtok: 0.1,
          cache_write_5m_usd_per_mtok: 1.25,
          cache_write_1h_usd_per_mtok: 2,
        },
        "claude-opus-5-5": {
          input_usd_per_mtok: 4,
          output_usd_per_mtok: 20,
          cache_read_usd_per_mtok: 0.2,
          cache_write_5m_usd_per_mtok: 5,
          cache_write_1h_usd_per_mtok: 8,
        },
        "claude-haiku-5-5": {
          input_usd_per_mtok: 0.1,
          output_usd_per_mtok: 0.5,
          cache_read_usd_per_mtok: 0.01,
          cache_write_5m_usd_per_mtok: 0.125,
          cache_write_1h_usd_per_mtok: 0.2,
          long_context: {
            above_input_tokens: 100_000,
            input_usd_per_mtok: 0.5,
            output_usd_per_mtok: 2.5,
            cache_read_usd_per_mtok: 0.05,
            cache_write_5m_usd_per_mtok: 0.625,
            cache_write_1h_usd_per_mtok: 1,
          },
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
    /** Thinking tokens count toward this limit (adaptive thinking on Anthropic). */
    max_output_tokens: z.number().int().positive().default(16000),
    max_context_tokens: z.number().int().positive().default(180000),
    /** Anthropic adaptive thinking: "summarized" returns readable thinking text, "omitted" returns empty blocks. */
    thinking_display: z.enum(["omitted", "summarized", "updates"]).default("summarized"),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    max_tool_iterations: z.number().int().positive().default(6),
  }),
  server: z.object({
    port: z.number().int().default(3000),
    database_url: z.string().default("./data/app.db"),
    mcp_servers_base: z.string().default("../mcp-server"),
    /** Deadline for one MCP tool call; sent to the server as `_meta.deadline_ms`. */
    mcp_tool_timeout_ms: z.number().int().positive().default(60000),
    cors_origins: z.array(z.string()).default(["http://localhost:3000", "http://localhost:3001"]),
    log_dir: z.string().default("../logs"),
    log_level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("DEBUG"),
  }),
  tool_search: z.object({
    bm25_weight: z.number().default(1.0),
    semantic_weight: z.number().default(1.0),
    short_query_threshold: z.number().int().default(4),
    short_query_bm25_weight: z.number().default(2.0),
    top_k: z.number().int().default(5),
    candidate_k: z.number().int().default(30),
    /** Tool embeddings index (v2). Relative paths resolve against app/. */
    embeddings_path: z.string().default("./data/tool-embeddings.json"),
  }),
  embedding: EmbeddingConfigSchema.default({}),
  platforms: z.record(z.string(), PlatformSchema).default({}),
  artifact: ArtifactConfigSchema.default({}),
  observability: z.object({
    langfuse: LangfuseConfigSchema.default({}),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type PlatformConfig = z.infer<typeof PlatformSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(APP_DIR, "config.yaml");

function loadYamlFile(): Record<string, unknown> {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

type Env = Record<string, string | undefined>;

/** Strict boolean env parsing: a plain `!!` would read "false" as true. */
export function parseBooleanEnv(name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw new Error(`Invalid ${name}=${JSON.stringify(value)}: expected "true", "false", "1" or "0"`);
}

function applyEmbeddingEnv(cfg: AppConfig, e: Env): void {
  const emb: Record<string, unknown> = { ...cfg.embedding };
  if (Boolean(e.EMBEDDING_PROVIDER) !== Boolean(e.EMBEDDING_MODEL)) {
    throw new Error("Invalid embedding config: set EMBEDDING_PROVIDER and EMBEDDING_MODEL together");
  }
  if (e.EMBEDDING_PROVIDER) emb.provider = e.EMBEDDING_PROVIDER;
  if (e.EMBEDDING_MODEL) emb.model = e.EMBEDDING_MODEL;
  if (e.EMBEDDING_DIMENSIONS) {
    emb.dimensions = e.EMBEDDING_DIMENSIONS === "native" ? undefined : Number(e.EMBEDDING_DIMENSIONS);
  }
  if (e.EMBEDDING_QUERY_TIMEOUT_MS) emb.query_timeout_ms = Number(e.EMBEDDING_QUERY_TIMEOUT_MS);
  if (e.EMBEDDING_SYNC_ON_BOOT !== undefined) emb.sync_on_boot = parseBooleanEnv("EMBEDDING_SYNC_ON_BOOT", e.EMBEDDING_SYNC_ON_BOOT);
  if (e.EMBEDDING_SYNC_TIMEOUT_MS) emb.sync_timeout_ms = Number(e.EMBEDDING_SYNC_TIMEOUT_MS);

  const parsed = EmbeddingConfigSchema.safeParse(emb);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid embedding config (after env overrides): ${issues}`);
  }
  cfg.embedding = parsed.data;
}

function applyEnvOverrides(cfg: AppConfig, e: Env): AppConfig {
  if (e.LLM_PROVIDER) cfg.llm.provider = e.LLM_PROVIDER as AppConfig["llm"]["provider"];
  if (e.LLM_CHAT_MODEL || e.CLAUDE_MODEL) cfg.llm.chat_model = (e.LLM_CHAT_MODEL || e.CLAUDE_MODEL)!;
  if (e.LLM_TITLE_MODEL || e.CLAUDE_TITLE_MODEL) cfg.llm.title_model = (e.LLM_TITLE_MODEL || e.CLAUDE_TITLE_MODEL)!;
  if (e.LLM_EFFORT) cfg.llm.effort = AppConfigSchema.shape.llm.shape.effort.parse(e.LLM_EFFORT, { path: ["llm", "effort"] });
  if (e.LLM_MAX_RETRIES) cfg.llm.max_retries = parseInt(e.LLM_MAX_RETRIES, 10);
  if (e.LLM_MAX_OUTPUT_TOKENS) cfg.llm.max_output_tokens = parseInt(e.LLM_MAX_OUTPUT_TOKENS, 10);
  if (e.LLM_MAX_CONTEXT_TOKENS !== undefined) {
    cfg.llm.max_context_tokens = AppConfigSchema.shape.llm.shape.max_context_tokens.parse(Number(e.LLM_MAX_CONTEXT_TOKENS), { path: ["llm", "max_context_tokens"] });
  }
  if (e.LLM_MAX_TOOL_ITERATIONS) cfg.llm.max_tool_iterations = parseInt(e.LLM_MAX_TOOL_ITERATIONS, 10);

  if (e.DEFAULT_DAILY_COST_LIMIT_USD) cfg.usage.default_daily_cost_limit_usd = parseFloat(e.DEFAULT_DAILY_COST_LIMIT_USD);
  if (e.DEFAULT_MONTHLY_COST_LIMIT_USD) cfg.usage.default_monthly_cost_limit_usd = parseFloat(e.DEFAULT_MONTHLY_COST_LIMIT_USD);
  if (e.MAX_CHAT_INPUT_CHARS) cfg.usage.max_chat_input_chars = parseInt(e.MAX_CHAT_INPUT_CHARS, 10);

  if (e.PORT) cfg.server.port = parseInt(e.PORT, 10);
  if (e.DATABASE_URL) cfg.server.database_url = e.DATABASE_URL;
  if (e.MCP_SERVERS_BASE) cfg.server.mcp_servers_base = e.MCP_SERVERS_BASE;
  if (e.MCP_TOOL_TIMEOUT_MS !== undefined) {
    cfg.server.mcp_tool_timeout_ms = AppConfigSchema.shape.server.shape.mcp_tool_timeout_ms.parse(Number(e.MCP_TOOL_TIMEOUT_MS), { path: ["server", "mcp_tool_timeout_ms"] });
  }
  if (e.CORS_ORIGINS) cfg.server.cors_origins = e.CORS_ORIGINS.split(",").map((o) => o.trim());
  if (e.LOG_DIR) cfg.server.log_dir = e.LOG_DIR;
  if (e.LOG_LEVEL) cfg.server.log_level = e.LOG_LEVEL as AppConfig["server"]["log_level"];

  if (e.TOOL_SEARCH_BM25_WEIGHT) cfg.tool_search.bm25_weight = parseFloat(e.TOOL_SEARCH_BM25_WEIGHT);
  if (e.TOOL_SEARCH_SEMANTIC_WEIGHT) cfg.tool_search.semantic_weight = parseFloat(e.TOOL_SEARCH_SEMANTIC_WEIGHT);
  if (e.TOOL_SEARCH_SHORT_QUERY_THRESHOLD) cfg.tool_search.short_query_threshold = parseInt(e.TOOL_SEARCH_SHORT_QUERY_THRESHOLD, 10);
  if (e.TOOL_SEARCH_SHORT_QUERY_BM25_WEIGHT) cfg.tool_search.short_query_bm25_weight = parseFloat(e.TOOL_SEARCH_SHORT_QUERY_BM25_WEIGHT);
  if (e.TOOL_SEARCH_TOP_K) cfg.tool_search.top_k = parseInt(e.TOOL_SEARCH_TOP_K, 10);
  if (e.TOOL_SEARCH_CANDIDATE_K) cfg.tool_search.candidate_k = parseInt(e.TOOL_SEARCH_CANDIDATE_K, 10);
  if (e.TOOL_EMBEDDINGS_PATH) cfg.tool_search.embeddings_path = e.TOOL_EMBEDDINGS_PATH;

  applyEmbeddingEnv(cfg, e);

  const lf = cfg.observability.langfuse;
  if (e.LANGFUSE_ENABLED !== undefined) lf.enabled = parseBooleanEnv("LANGFUSE_ENABLED", e.LANGFUSE_ENABLED);
  if (e.LANGFUSE_TRACING_ENVIRONMENT) lf.environment = e.LANGFUSE_TRACING_ENVIRONMENT;
  if (e.LANGFUSE_FULL_GENERATION_INPUT !== undefined) {
    lf.full_generation_input = parseBooleanEnv("LANGFUSE_FULL_GENERATION_INPUT", e.LANGFUSE_FULL_GENERATION_INPUT);
  }

  return cfg;
}

export function loadConfig(env: Env = process.env, raw: Record<string, unknown> = loadYamlFile()): AppConfig {
  const cfg = applyEnvOverrides(AppConfigSchema.parse(raw), env);
  cfg.server.log_dir = resolve(APP_DIR, cfg.server.log_dir);
  cfg.server.mcp_servers_base = resolve(APP_DIR, cfg.server.mcp_servers_base);
  cfg.tool_search.embeddings_path = resolve(APP_DIR, cfg.tool_search.embeddings_path);
  return cfg;
}

export const appConfig: AppConfig = loadConfig();
