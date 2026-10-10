/**
 * Config: the embedding block is validated again after env overrides, booleans
 * parse strictly, and the embeddings index path doesn't depend on cwd.
 */
import { describe, expect, it } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { APP_DIR, loadConfig as loadFromYaml, parseBooleanEnv } from "../config";

// Sections without schema defaults; everything else comes from built-in defaults.
const loadConfig = (env: Record<string, string | undefined>, raw: Record<string, unknown>) =>
  loadFromYaml(env, { llm: { effort: "medium" }, server: {}, tool_search: {}, ...raw });

describe("embedding config", () => {
  it("defaults to OpenAI text-embedding-3-small with a 2s query timeout", () => {
    expect(loadConfig({}, {}).embedding).toMatchObject({ provider: "openai", model: "text-embedding-3-small", query_timeout_ms: 2000 });
    expect(loadConfig({}, {}).embedding.dimensions).toBeUndefined();
  });

  it("applies provider, model, dimensions and timeout overrides", () => {
    const cfg = loadConfig(
      { EMBEDDING_PROVIDER: "google", EMBEDDING_MODEL: "gemini-embedding-001", EMBEDDING_DIMENSIONS: "768", EMBEDDING_QUERY_TIMEOUT_MS: "500" },
      {}
    );
    expect(cfg.embedding).toMatchObject({ provider: "google", model: "gemini-embedding-001", dimensions: 768, query_timeout_ms: 500 });
  });

  it("config.yaml pins the native 1536 dims", () => {
    expect(loadFromYaml({}).embedding).toMatchObject({ provider: "openai", model: "text-embedding-3-small", dimensions: 1536 });
  });

  it("EMBEDDING_DIMENSIONS=native clears a configured size", () => {
    const raw = { embedding: { dimensions: 1536 } };
    expect(loadConfig({}, raw).embedding.dimensions).toBe(1536);
    expect(loadConfig({ EMBEDDING_DIMENSIONS: "native" }, raw).embedding.dimensions).toBeUndefined();
  });

  it("is independent of the chat LLM provider", () => {
    const cfg = loadConfig({ LLM_PROVIDER: "google" }, {});
    expect(cfg.llm.provider).toBe("google");
    expect(cfg.embedding.provider).toBe("openai");
  });

  it.each([
    ["an unknown provider", { EMBEDDING_PROVIDER: "foo", EMBEDDING_MODEL: "m" }, /provider/],
    ["negative dimensions", { EMBEDDING_DIMENSIONS: "-1" }, /dimensions/],
    ["non-integer dimensions", { EMBEDDING_DIMENSIONS: "12abc" }, /dimensions/],
    ["a zero timeout", { EMBEDDING_QUERY_TIMEOUT_MS: "0" }, /query_timeout_ms/],
    ["a provider without a model", { EMBEDDING_PROVIDER: "google" }, /together/],
    ["a model without a provider", { EMBEDDING_MODEL: "text-embedding-3-large" }, /together/],
  ])("fails at load for %s", (_label, env, message) => {
    expect(() => loadConfig(env, {})).toThrow(message);
  });

  it("rejects a bad provider in config.yaml too", () => {
    expect(() => loadConfig({}, { embedding: { provider: "cohere" } })).toThrow();
  });
});

describe("parseBooleanEnv", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["TRUE", true],
    ["false", false],
    ["0", false],
    [" False ", false],
  ])("parses %p as %p", (value, expected) => {
    expect(parseBooleanEnv("FLAG", value)).toBe(expected);
  });

  it.each(["maybe", "yes", ""])("rejects %p", (value) => {
    expect(() => parseBooleanEnv("FLAG", value)).toThrow(/FLAG/);
  });
});

describe("context budget", () => {
  it("defaults to 180000 input tokens and accepts YAML and environment overrides", () => {
    expect(loadConfig({}, {}).llm.max_context_tokens).toBe(180000);
    expect(loadConfig({}, { llm: { effort: "medium", max_context_tokens: 12345 } }).llm.max_context_tokens).toBe(12345);
    expect(loadConfig({ LLM_MAX_CONTEXT_TOKENS: "54321" }, {}).llm.max_context_tokens).toBe(54321);
  });

  it.each(["0", "-1", "1.5", "12abc"])("rejects invalid LLM_MAX_CONTEXT_TOKENS=%s", (value) => {
    expect(() => loadConfig({ LLM_MAX_CONTEXT_TOKENS: value }, {})).toThrow(/max_context_tokens/);
  });
});

describe("embedding sync controls", () => {
  it("defaults to syncing with a two-minute attempt deadline", () => {
    const { embedding } = loadConfig({}, {});
    expect(embedding.sync_on_boot).toBe(true);
    expect(embedding.sync_timeout_ms).toBe(120_000);
  });

  it("parses EMBEDDING_SYNC_ON_BOOT explicitly", () => {
    expect(loadConfig({ EMBEDDING_SYNC_ON_BOOT: "false" }, {}).embedding.sync_on_boot).toBe(false);
    expect(loadConfig({ EMBEDDING_SYNC_ON_BOOT: "1" }, { embedding: { sync_on_boot: false } }).embedding.sync_on_boot).toBe(true);
    expect(() => loadConfig({ EMBEDDING_SYNC_ON_BOOT: "maybe" }, {})).toThrow(/EMBEDDING_SYNC_ON_BOOT/);
  });

  it("rejects an empty EMBEDDING_SYNC_ON_BOOT instead of silently keeping the default", () => {
    expect(() => loadConfig({ EMBEDDING_SYNC_ON_BOOT: "" }, {})).toThrow(/EMBEDDING_SYNC_ON_BOOT/);
    expect(() => loadConfig({ EMBEDDING_SYNC_ON_BOOT: "" }, { embedding: { sync_on_boot: false } })).toThrow(/EMBEDDING_SYNC_ON_BOOT/);
  });

  it("validates EMBEDDING_SYNC_TIMEOUT_MS", () => {
    expect(loadConfig({ EMBEDDING_SYNC_TIMEOUT_MS: "5000" }, {}).embedding.sync_timeout_ms).toBe(5000);
    expect(() => loadConfig({ EMBEDDING_SYNC_TIMEOUT_MS: "-1" }, {})).toThrow(/sync_timeout_ms/);
  });
});

describe("tool_search.embeddings_path", () => {
  it("resolves relative paths against app/", () => {
    expect(loadConfig({}, {}).tool_search.embeddings_path).toBe(join(APP_DIR, "data", "tool-embeddings.json"));
    expect(loadConfig({ TOOL_EMBEDDINGS_PATH: "./elsewhere/idx.json" }, {}).tool_search.embeddings_path).toBe(
      join(APP_DIR, "elsewhere", "idx.json")
    );
    expect(loadConfig({ TOOL_EMBEDDINGS_PATH: "/abs/idx.json" }, {}).tool_search.embeddings_path).toBe("/abs/idx.json");
  });

  it("resolves to the same absolute path from different working directories", () => {
    const configModule = join(APP_DIR, "server", "config.ts");
    const script = `const { appConfig } = await import(${JSON.stringify(configModule)}); console.log(appConfig.tool_search.embeddings_path);`;
    const { TOOL_EMBEDDINGS_PATH: _omit, ...env } = process.env;

    const run = (cwd: string) => {
      const proc = Bun.spawnSync([process.execPath, "-e", script], { cwd, env: { ...env, LOG_DIR: join(tmpdir(), "burp-config-test-logs") } });
      expect(proc.exitCode).toBe(0);
      return proc.stdout.toString().trim();
    };

    const fromApp = run(APP_DIR);
    const fromElsewhere = run(tmpdir());
    expect(fromApp).toBe(fromElsewhere);
    expect(fromApp.startsWith(APP_DIR)).toBe(true);
  });
});

describe("usage pricing rates", () => {
  const withRates = (rates: Record<string, unknown>) => ({
    usage: { pricing: { anthropic: { m: { input_usd_per_mtok: 3, output_usd_per_mtok: 15, ...rates } } } },
  });

  it("every rate in config.yaml and the built-in defaults parses", () => {
    expect(() => loadFromYaml({})).not.toThrow();
    expect(() => loadConfig({}, {})).not.toThrow();
  });

  it("accepts rates down to whole µUSD per MTok", () => {
    const cfg = loadConfig({}, withRates({ cache_read_usd_per_mtok: 0.000001, cache_write_5m_usd_per_mtok: 0.3 }));
    expect(cfg.usage.pricing.anthropic!.m!.cache_read_usd_per_mtok).toBe(0.000001);
  });

  it("rejects a rate finer than 1 µUSD per MTok instead of rounding it", () => {
    expect(() => loadConfig({}, withRates({ input_usd_per_mtok: 0.0000014 }))).toThrow(/whole number of µUSD per MTok/);
    expect(() => loadConfig({}, withRates({ cache_write_1h_usd_per_mtok: 3.0000005 }))).toThrow(/whole number of µUSD/);
  });

  it("rejects a sub-µUSD long-context rate", () => {
    const longContext = {
      above_input_tokens: 200_000,
      input_usd_per_mtok: 6,
      output_usd_per_mtok: 22.5,
      cache_read_usd_per_mtok: 0.6,
      cache_write_5m_usd_per_mtok: 7.5,
      cache_write_1h_usd_per_mtok: 12.0000001,
    };
    expect(() => loadConfig({}, withRates({ long_context: longContext }))).toThrow(/whole number of µUSD/);
  });
});
