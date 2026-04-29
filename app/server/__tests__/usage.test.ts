import { describe, expect, it } from "bun:test";
import {
  calculateChatCost,
  defaultCostLimitMicrousd,
  getRemainingMicrousd,
  PricingConfigError,
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
