import { describe, expect, it } from "bun:test";
import {
  calculateChatCost,
  defaultCostLimitMicrousd,
  getRemainingMicrousd,
  PricingConfigError,
  resolveEffectiveLimits,
  usdToMicrousd,
} from "../usage";

describe("usage cost accounting", () => {
  it("calculates main chat input and output cost in microdollars", () => {
    const cost = calculateChatCost({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 1000,
    });

    expect(cost.inputCostPerMtokMicrousd).toBe(1_000_000);
    expect(cost.outputCostPerMtokMicrousd).toBe(5_000_000);
    expect(cost.costMicrousd).toBe(6_000);
  });

  it("rounds tiny non-zero usage up to one microdollar", () => {
    const cost = calculateChatCost({
      provider: "google",
      model: "gemini-3-flash-preview",
      inputTokens: 1,
      outputTokens: 0,
    });

    expect(cost.costMicrousd).toBe(1);
  });

  it("fails closed when active model pricing is missing", () => {
    expect(() =>
      calculateChatCost({
        provider: "anthropic",
        model: "not-configured",
        inputTokens: 1,
        outputTokens: 1,
      })
    ).toThrow(PricingConfigError);
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
