import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import type { LanguageModelUsage, ProviderMetadata } from "ai";
import { loadConfig } from "../config";
import { logger } from "../logger";
import { splitCallUsage, UsageMeter, type CallLogInfo } from "../orchestration/usage-meter";

const sdkUsage = (input: {
  total: number;
  noCache?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
}): LanguageModelUsage => ({
  inputTokens: input.total,
  inputTokenDetails: {
    noCacheTokens: input.noCache,
    cacheReadTokens: input.cacheRead,
    cacheWriteTokens: input.cacheWrite,
  },
  outputTokens: input.output ?? 0,
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  totalTokens: undefined,
});

const anthropicMeta = (cacheCreation?: Record<string, number>): ProviderMetadata => ({
  anthropic: { usage: cacheCreation ? { cache_creation: cacheCreation } : { input_tokens: 1 } },
});

const info = (iteration = 1): CallLogInfo => ({
  iteration,
  durationMs: 10,
  finishReason: "stop",
  toolCalls: 0,
  toolNames: ["a", "b"],
  systemPrompt: "system",
});

const ctx = { session_id: "s", user_id: "u" };

let infoSpy: Mock<typeof logger.info>;
let warnSpy: Mock<typeof logger.warn>;
beforeEach(() => {
  infoSpy = spyOn(logger, "info").mockImplementation(() => {});
  warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
});
afterEach(() => {
  infoSpy.mockRestore();
  warnSpy.mockRestore();
});

const events = (spy: Mock<typeof logger.info>, event: string) =>
  spy.mock.calls.filter((c) => c[1] === event).map((c) => c[2]?.data as Record<string, unknown>);

describe("splitCallUsage", () => {
  it("takes the 5m/1h write split from Anthropic's cache_creation", () => {
    const split = splitCallUsage(
      sdkUsage({ total: 1500, noCache: 100, cacheRead: 1000, cacheWrite: 400, output: 50 }),
      anthropicMeta({ ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 100 })
    );
    expect(split.usage).toEqual({
      noCacheTokens: 100,
      cacheReadTokens: 1000,
      cacheWrite5mTokens: 300,
      cacheWrite1hTokens: 100,
      outputTokens: 50,
    });
    expect(split.gap).toBe(0);
  });

  it("counts every write as 5m when cache_creation is missing", () => {
    for (const meta of [anthropicMeta(), undefined]) {
      const split = splitCallUsage(sdkUsage({ total: 500, noCache: 100, cacheRead: 0, cacheWrite: 400 }), meta);
      expect(split.usage.cacheWrite5mTokens).toBe(400);
      expect(split.usage.cacheWrite1hTokens).toBe(0);
    }
  });

  it("maps Google cached tokens to reads, with no writes", () => {
    const split = splitCallUsage(sdkUsage({ total: 1000, noCache: 400, cacheRead: 600, output: 20 }), {
      google: { usageMetadata: { cachedContentTokenCount: 600 } },
    });
    expect(split.usage).toEqual({
      noCacheTokens: 400,
      cacheReadTokens: 600,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 20,
    });
    expect(split.gap).toBe(0);
  });
});

describe("UsageMeter", () => {
  it("charges a missing category gap at the input rate and logs usage_mismatch", () => {
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    const call = meter.record(sdkUsage({ total: 1100, noCache: 100, cacheRead: 900, cacheWrite: 0 }), undefined, info());

    expect(call.noCacheTokens).toBe(200);
    expect(call.promptTokens).toBe(1100);
    expect(call.inputCostPicoUsd).toBe(200 * 2_000_000);
    expect(events(warnSpy, "usage_mismatch")).toEqual([
      expect.objectContaining({ input_tokens: 1100, gap: 100 }),
    ]);
  });

  it("does not warn when the categories add up", () => {
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    meter.record(sdkUsage({ total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }), undefined, info());
    expect(events(warnSpy, "usage_mismatch")).toEqual([]);
  });

  it("prices each call on its own and fills the ledger columns", () => {
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    meter.record(
      sdkUsage({ total: 3000, noCache: 1000, cacheRead: 0, cacheWrite: 2000, output: 100 }),
      anthropicMeta({ ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 0 }),
      info(1)
    );
    meter.record(
      sdkUsage({ total: 3500, noCache: 1500, cacheRead: 2000, cacheWrite: 0, output: 200 }),
      anthropicMeta({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }),
      info(2)
    );

    const fields = meter.ledgerFields();
    expect(fields).toMatchObject({
      input_tokens: 6500,
      output_tokens: 300,
      cache_read_tokens: 2000,
      cache_write_5m_tokens: 2000,
      cache_write_1h_tokens: 0,
      input_cost_per_mtok_microusd: 2_000_000,
      output_cost_per_mtok_microusd: 10_000_000,
      input_cost_microusd: 5000,
      cache_read_cost_microusd: 200,
      cache_write_cost_microusd: 5000,
      output_cost_microusd: 3000,
      cost_microusd: 13_200,
      llm_calls: 2,
      long_context_calls: 0,
    });
    expect(JSON.parse(fields.pricing_json!)).toMatchObject({ input_usd_per_mtok: 2, cache_read_usd_per_mtok: 0.1 });

    const logged = events(infoSpy, "llm_response_received");
    expect(logged).toHaveLength(2);
    expect(logged[1]).toMatchObject({
      prompt_tokens: 3500,
      no_cache: 1500,
      cache_read: 2000,
      cache_write_5m: 0,
      cache_write_1h: 0,
      pricing_tier: "base",
      call_cost_microusd: 5200,
      tool_count: 2,
    });
    expect(logged[1]!.tools_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(logged[1]!.system_hash).toMatch(/^[0-9a-f]{8}$/);

    expect(meter.logFields()).toMatchObject({ cache_hit_ratio: Number((2000 / 6500).toFixed(4)), llm_calls: 2 });
  });

  it("warns once per long-context call", () => {
    const meter = new UsageMeter("anthropic", "claude-haiku-5-5", ctx);
    meter.record(sdkUsage({ total: 60_000, noCache: 60_000, cacheRead: 0, cacheWrite: 0 }), undefined, info(1));
    meter.record(sdkUsage({ total: 100_001, noCache: 1, cacheRead: 100_000, cacheWrite: 0 }), undefined, info(2));

    expect(events(warnSpy, "pricing_long_context_tier")).toEqual([
      expect.objectContaining({ iteration: 2, prompt_tokens: 100_001 }),
    ]);
    expect(meter.summary()).toMatchObject({ llmCalls: 2, longContextCalls: 1 });
  });

  it("records Google calls with the configured pricing", () => {
    const config = loadConfig({}, {
      llm: { effort: "medium" },
      server: {},
      tool_search: {},
      usage: { pricing: { google: { "gemini-3-flash-preview": { input_usd_per_mtok: 0.5, output_usd_per_mtok: 3 } } } },
    });
    const meter = new UsageMeter("google", "gemini-3-flash-preview", ctx, config);
    meter.record(sdkUsage({ total: 1000, noCache: 400, cacheRead: 600, output: 10 }), undefined, info());

    expect(meter.ledgerFields()).toMatchObject({
      input_tokens: 1000,
      cache_read_tokens: 600,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
      cost_microusd: 530,
    });
  });

  it("has nothing to record before the first call finishes", () => {
    const meter = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
    expect(meter.callCount).toBe(0);
    expect(meter.ledgerFields()).toMatchObject({ llm_calls: 0, cost_microusd: 0, input_tokens: 0 });
  });
});
