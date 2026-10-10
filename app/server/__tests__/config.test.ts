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
  loadFromYaml(env, { llm: {}, server: {}, tool_search: {}, ...raw });

describe("embedding config", () => {
  it("defaults to OpenAI text-embedding-3-small with a 2s query timeout", () => {
    expect(loadConfig({}, {}).embedding).toEqual({ provider: "openai", model: "text-embedding-3-small", query_timeout_ms: 2000 });
  });

  it("applies provider, model, dimensions and timeout overrides", () => {
    const cfg = loadConfig(
      { EMBEDDING_PROVIDER: "google", EMBEDDING_MODEL: "gemini-embedding-001", EMBEDDING_DIMENSIONS: "768", EMBEDDING_QUERY_TIMEOUT_MS: "500" },
      {}
    );
    expect(cfg.embedding).toEqual({ provider: "google", model: "gemini-embedding-001", dimensions: 768, query_timeout_ms: 500 });
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
