/** observability.langfuse config + env overrides, and how `release` is resolved. */
import { describe, expect, it } from "bun:test";
import { loadConfig } from "../../config";
import { resolveRelease } from "../langfuse";

const yaml = { llm: { effort: "medium" }, server: {}, tool_search: {} };

describe("observability.langfuse config", () => {
  it("defaults: enabled, dev, delta generation inputs", () => {
    expect(loadConfig({}, yaml).observability.langfuse).toEqual({
      enabled: true,
      environment: "dev",
      full_generation_input: false,
    });
  });

  it("env overrides YAML", () => {
    const raw = { ...yaml, observability: { langfuse: { enabled: true, environment: "dev" } } };
    const cfg = loadConfig(
      { LANGFUSE_ENABLED: "false", LANGFUSE_TRACING_ENVIRONMENT: "prod", LANGFUSE_FULL_GENERATION_INPUT: "1" },
      raw
    );
    expect(cfg.observability.langfuse).toEqual({ enabled: false, environment: "prod", full_generation_input: true });
  });

  it("rejects a non-boolean LANGFUSE_ENABLED", () => {
    expect(() => loadConfig({ LANGFUSE_ENABLED: "yes" }, yaml)).toThrow(/LANGFUSE_ENABLED/);
  });
});

describe("resolveRelease", () => {
  it("prefers GIT_SHA, then the git short sha, then unknown", () => {
    expect(resolveRelease({ GIT_SHA: "abc1234" }, () => "def5678")).toBe("abc1234");
    expect(resolveRelease({}, () => "def5678")).toBe("def5678");
    expect(resolveRelease({ GIT_SHA: " " }, () => undefined)).toBe("unknown");
  });

  it("reads the checkout's sha by default", () => {
    expect(resolveRelease({})).toMatch(/^[0-9a-f]{7,}$/);
  });
});
