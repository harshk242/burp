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

const AppConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(["anthropic", "google"]).default("anthropic"),
    chat_model: z.string().default("claude-haiku-4-5"),
    title_model: z.string().default("claude-haiku-4-5"),
    summarizer_model: z.string().default("claude-haiku-4-5"),
    max_retries: z.number().int().default(3),
    tool_output_summary_threshold: z.number().int().default(15000),
  }),
  features: z.object({
    use_vercel_ai: z.boolean().default(true),
  }),
  server: z.object({
    port: z.number().int().default(3000),
    database_url: z.string().default("./data/super-bio-agent.db"),
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
  if (e.LLM_SUMMARIZER_MODEL || e.TOOL_SUMMARIZER_MODEL) cfg.llm.summarizer_model = (e.LLM_SUMMARIZER_MODEL || e.TOOL_SUMMARIZER_MODEL)!;
  if (e.LLM_MAX_RETRIES) cfg.llm.max_retries = parseInt(e.LLM_MAX_RETRIES, 10);
  if (e.TOOL_OUTPUT_SUMMARY_THRESHOLD) cfg.llm.tool_output_summary_threshold = parseInt(e.TOOL_OUTPUT_SUMMARY_THRESHOLD, 10);

  // Features
  if (e.USE_VERCEL_AI !== undefined) cfg.features.use_vercel_ai = e.USE_VERCEL_AI !== "false";

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
