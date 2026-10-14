import { describe, expect, it } from "bun:test";
import { loadConfig } from "../config";
import {
  assertPricingConfigured,
  defaultCostLimitMicrousd,
  getRemainingMicrousd,
  priceCall,
  PricingConfigError,
  resolveEffectiveLimits,
  summarizeTurnCost,
  usdToMicrousd,
  type CallUsage,
} from "../usage";

const usage = (u: Partial<CallUsage>): CallUsage => ({
  noCacheTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 0,
  ...u,
});

const configWithPricing = (pricing: Record<string, unknown>) =>
  loadConfig({}, { llm: { effort: "medium" }, server: {}, tool_search: {}, usage: { pricing } });

describe("priceCall", () => {
  it("prices a Sonnet 5.5 call that mixes every category exactly", () => {
    const cost = priceCall(
      "anthropic",
      "claude-sonnet-5-5",
      usage({ noCacheTokens: 1234, cacheReadTokens: 50_000, cacheWrite5mTokens: 2000, cacheWrite1hTokens: 1000, outputTokens: 500 })
    );

    expect(cost.promptTokens).toBe(54_234);
    expect(cost.tier).toBe("base");
    expect(cost.inputCostPicoUsd).toBe(1234 * 2_000_000);
    expect(cost.cacheReadCostPicoUsd).toBe(50_000 * 100_000);
    expect(cost.cacheWriteCostPicoUsd).toBe(2000 * 2_500_000 + 1000 * 4_000_000);
    expect(cost.outputCostPicoUsd).toBe(500 * 10_000_000);
    expect(cost.costPicoUsd).toBe(21_468_000_000);
    expect(summarizeTurnCost([cost]).costMicrousd).toBe(21_468);
  });

  it("keeps Haiku 5.5 at the base tier at exactly 100,000 prompt tokens", () => {
    const cost = priceCall("anthropic", "claude-haiku-5-5", usage({ noCacheTokens: 10_000, cacheReadTokens: 90_000, outputTokens: 1000 }));

    expect(cost.promptTokens).toBe(100_000);
    expect(cost.tier).toBe("base");
    expect(cost.costPicoUsd).toBe(10_000 * 100_000 + 90_000 * 10_000 + 1000 * 500_000);
  });

  it("prices every Haiku 5.5 category, output included, at the long-context tier above 100,000", () => {
    const cost = priceCall(
      "anthropic",
      "claude-haiku-5-5",
      usage({ noCacheTokens: 10_000, cacheReadTokens: 89_999, cacheWrite5mTokens: 1, cacheWrite1hTokens: 1, outputTokens: 1000 })
    );

    expect(cost.promptTokens).toBe(100_001);
    expect(cost.tier).toBe("long_context");
    expect(cost.inputCostPicoUsd).toBe(10_000 * 500_000);
    expect(cost.cacheReadCostPicoUsd).toBe(89_999 * 50_000);
    expect(cost.cacheWriteCostPicoUsd).toBe(625_000 + 1_000_000);
    expect(cost.outputCostPicoUsd).toBe(1000 * 2_500_000);
  });

  it("counts cache reads toward the long-context threshold", () => {
    expect(priceCall("anthropic", "claude-haiku-5-5", usage({ cacheReadTokens: 100_001 })).tier).toBe("long_context");
  });

  it("prices the uncached input rate for models without cache rates (Gemini)", () => {
    const cost = priceCall("google", "gemini-3-flash-preview", usage({ cacheReadTokens: 1000 }));
    expect(cost.cacheReadCostPicoUsd).toBe(1000 * 500_000);
  });

  it("falls back to input for reads and 1.25x / 2x input for writes", () => {
    const config = configWithPricing({ acme: { flat: { input_usd_per_mtok: 1, output_usd_per_mtok: 5 } } });
    const cost = priceCall(
      "acme",
      "flat",
      usage({ cacheReadTokens: 1000, cacheWrite5mTokens: 1000, cacheWrite1hTokens: 1000 }),
      config
    );

    expect(cost.cacheReadCostPicoUsd).toBe(1000 * 1_000_000);
    expect(cost.cacheWriteCostPicoUsd).toBe(1000 * 1_250_000 + 1000 * 2_000_000);
    expect(cost.tier).toBe("base");
  });

  it("throws instead of losing precision on overflow", () => {
    expect(() => priceCall("anthropic", "claude-sonnet-5-5", usage({ outputTokens: 1e12 }))).toThrow(RangeError);
  });

  it("rejects negative or fractional token counts", () => {
    expect(() => priceCall("anthropic", "claude-sonnet-5-5", usage({ outputTokens: -1 }))).toThrow(RangeError);
    expect(() => priceCall("anthropic", "claude-sonnet-5-5", usage({ noCacheTokens: 1.5 }))).toThrow(RangeError);
  });

  it("fails closed when model pricing is missing", () => {
    expect(() => priceCall("anthropic", "not-configured", usage({ outputTokens: 1 }))).toThrow(PricingConfigError);
  });
});

describe("summarizeTurnCost", () => {
  it("prices each call on its own: 3 x 60K Haiku 5.5 calls stay at the base tier", () => {
    const calls = [1, 2, 3].map(() => priceCall("anthropic", "claude-haiku-5-5", usage({ noCacheTokens: 60_000 })));
    const turn = summarizeTurnCost(calls);

    expect(turn.inputTokens).toBe(180_000);
    expect(turn.longContextCalls).toBe(0);
    expect(turn.llmCalls).toBe(3);
    expect(turn.costMicrousd).toBe(3 * 6000);
    expect(priceCall("anthropic", "claude-haiku-5-5", usage({ noCacheTokens: 180_000 })).tier).toBe("long_context");
  });

  it("rounds up once per turn: ceil(sum), not sum(ceil)", () => {
    const calls = Array.from({ length: 20 }, () => priceCall("anthropic", "claude-haiku-5-5", usage({ outputTokens: 1 })));
    expect(summarizeTurnCost(calls).costMicrousd).toBe(10);
    expect(summarizeTurnCost(calls.slice(0, 3)).costMicrousd).toBe(2);
  });

  it("sums tokens and floors category costs, which may add up below the total", () => {
    const turn = summarizeTurnCost([
      priceCall("anthropic", "claude-sonnet-5-5", usage({ noCacheTokens: 1, cacheReadTokens: 7, cacheWrite5mTokens: 3, cacheWrite1hTokens: 2, outputTokens: 1 })),
    ]);

    expect(turn).toMatchObject({
      inputTokens: 13,
      noCacheTokens: 1,
      cacheReadTokens: 7,
      cacheWrite5mTokens: 3,
      cacheWrite1hTokens: 2,
      outputTokens: 1,
      inputCostMicrousd: 2,
      cacheReadCostMicrousd: 0,
      cacheWriteCostMicrousd: 15,
      outputCostMicrousd: 10,
      costPicoUsd: 28_200_000,
      costMicrousd: 29,
    });
  });

  it("returns zero for a turn with no calls", () => {
    expect(summarizeTurnCost([])).toMatchObject({ llmCalls: 0, costMicrousd: 0 });
  });
});

describe("pricing config", () => {
  const sonnet = { input_usd_per_mtok: 2, output_usd_per_mtok: 10 };
  const longContext = {
    above_input_tokens: 100_000,
    input_usd_per_mtok: 0.5,
    output_usd_per_mtok: 2.5,
    cache_read_usd_per_mtok: 0.05,
    cache_write_5m_usd_per_mtok: 0.625,
    cache_write_1h_usd_per_mtok: 1,
  };

  it.each(Object.keys(longContext))("rejects a long_context block missing %s", (field) => {
    const { [field as keyof typeof longContext]: _omitted, ...partial } = longContext;
    expect(() => configWithPricing({ acme: { m: { ...sonnet, long_context: partial } } })).toThrow();
  });

  it("rejects a non-positive long-context threshold", () => {
    expect(() => configWithPricing({ acme: { m: { ...sonnet, long_context: { ...longContext, above_input_tokens: 0 } } } })).toThrow();
  });

  it("config.yaml and the built-in defaults carry the Sonnet 5.5 and Haiku 5.5 rates", () => {
    const fromYaml = loadConfig({}).usage.pricing.anthropic;
    const defaults = loadConfig({}, { llm: { effort: "medium" }, server: {}, tool_search: {} }).usage.pricing.anthropic;
    for (const pricing of [fromYaml, defaults]) {
      expect(pricing["claude-sonnet-5-5"]?.cache_read_usd_per_mtok).toBe(0.1);
      expect(pricing["claude-haiku-5-5"]?.long_context).toEqual(longContext);
    }
  });

  it("config.yaml and the built-in defaults carry the Opus 5.5 rates", () => {
    const fromYaml = loadConfig({}).usage.pricing.anthropic;
    const defaults = loadConfig({}, { llm: { effort: "medium" }, server: {}, tool_search: {} }).usage.pricing.anthropic;
    for (const pricing of [fromYaml, defaults]) {
      expect(pricing["claude-opus-5-5"]).toEqual({
        input_usd_per_mtok: 4,
        output_usd_per_mtok: 20,
        cache_read_usd_per_mtok: 0.2,
        cache_write_5m_usd_per_mtok: 5,
        cache_write_1h_usd_per_mtok: 8,
      });
    }
    expect(() => assertPricingConfigured("anthropic", "claude-opus-5-5")).not.toThrow();
  });

  it("assertPricingConfigured fails only for unpriced models", () => {
    expect(() => assertPricingConfigured("anthropic", "claude-haiku-5-5")).not.toThrow();
    expect(() => assertPricingConfigured("anthropic", "not-configured")).toThrow(PricingConfigError);
  });
});

describe("usage budget helpers", () => {
  it("converts dollar limits to integer microdollars", () => {
    expect(usdToMicrousd(0.25)).toBe(250_000);
    expect(usdToMicrousd(3)).toBe(3_000_000);
  });

  it("makes admins unlimited by default", () => {
    expect(defaultCostLimitMicrousd(0.25, true)).toBe(-1);
    expect(defaultCostLimitMicrousd(0.25, false)).toBe(250_000);
  });

  it("calculates remaining spend without going negative", () => {
    expect(getRemainingMicrousd(250_000, 100_000)).toBe(150_000);
    expect(getRemainingMicrousd(250_000, 300_000)).toBe(0);
    expect(getRemainingMicrousd(-1, 300_000)).toBe(-1);
  });
});

describe("resolveEffectiveLimits", () => {
  const config = {
    rate_limits: { default_daily_tokens: 200_000 },
    usage: { default_daily_cost_limit_usd: 0.25, default_monthly_cost_limit_usd: 3 },
  } as Parameters<typeof resolveEffectiveLimits>[3];
  const noOverrides = {
    daily_query_limit: null,
    daily_token_limit: null,
    daily_cost_limit_microusd: null,
    monthly_cost_limit_microusd: null,
  };

  it("falls back to role and config defaults for users", () => {
    expect(resolveEffectiveLimits(noOverrides, "user", 50, config)).toEqual({
      daily_query_limit: 50,
      daily_token_limit: 200_000,
      daily_cost_limit_microusd: 250_000,
      monthly_cost_limit_microusd: 3_000_000,
    });
  });

  it("treats admins as unlimited by default", () => {
    expect(resolveEffectiveLimits(noOverrides, "admin", -1, config)).toEqual({
      daily_query_limit: -1,
      daily_token_limit: -1,
      daily_cost_limit_microusd: -1,
      monthly_cost_limit_microusd: -1,
    });
  });

  it("prefers per-user overrides, including explicit unlimited", () => {
    const limits = resolveEffectiveLimits(
      { daily_query_limit: 10, daily_token_limit: null, daily_cost_limit_microusd: -1, monthly_cost_limit_microusd: 5_000_000 },
      "user",
      50,
      config
    );
    expect(limits.daily_query_limit).toBe(10);
    expect(limits.daily_cost_limit_microusd).toBe(-1);
    expect(limits.monthly_cost_limit_microusd).toBe(5_000_000);
  });
});
