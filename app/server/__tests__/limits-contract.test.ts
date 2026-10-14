import { describe, expect, it } from "bun:test";
import { loadConfig } from "../config";
import { IntegerLimitSchema, LimitSchema } from "../schemas/limits";
import { UsageSchema } from "../schemas";
import { defaultCostLimitMicrousd, getRemainingMicrousd } from "../usage";

const raw = { llm: { effort: "medium" }, server: {}, tool_search: {} };
describe("limit contract", () => {
  it.each([-1, 0, 0.25, 100])("accepts %s", (limit) => {
    expect(LimitSchema.parse(limit)).toBe(limit);
    expect(loadConfig({}, { ...raw, usage: { default_daily_cost_limit_usd: limit } }).usage.default_daily_cost_limit_usd).toBe(limit);
    expect(loadConfig({ DEFAULT_MONTHLY_COST_LIMIT_USD: String(limit) }, raw).usage.default_monthly_cost_limit_usd).toBe(limit);
  });
  it.each([-2, -0.5, Infinity, -Infinity, NaN])("rejects %s across inputs", (limit) => {
    expect(LimitSchema.safeParse(limit).success).toBe(false);
    expect(IntegerLimitSchema.nullable().safeParse(limit).success).toBe(false);
    expect(() => loadConfig({}, { ...raw, usage: { default_daily_cost_limit_usd: limit } })).toThrow();
    expect(() => loadConfig({ DEFAULT_DAILY_COST_LIMIT_USD: String(limit) }, raw)).toThrow();
    expect(() => loadConfig({ DEFAULT_MONTHLY_COST_LIMIT_USD: String(limit) }, raw)).toThrow();
    expect(() => loadConfig({}, { ...raw, rate_limits: { default_daily_tokens: limit } })).toThrow();
    expect(UsageSchema.shape.limit.safeParse(limit).success).toBe(false);
  });
  it("keeps integer override semantics and zero caps", () => {
    expect(IntegerLimitSchema.nullable().parse(null)).toBeNull();
    expect(IntegerLimitSchema.parse(0)).toBe(0);
    expect(IntegerLimitSchema.safeParse(0.5).success).toBe(false);
    expect(defaultCostLimitMicrousd(-1, false)).toBe(-1);
    expect(getRemainingMicrousd(-1, 10)).toBe(-1);
    expect(getRemainingMicrousd(0, 0)).toBe(0);
  });
  it.each(["2oops", "Infinity", "NaN", "", "   "])("rejects malformed environment override %s", (value) => {
    expect(() => loadConfig({ DEFAULT_DAILY_COST_LIMIT_USD: value }, raw)).toThrow();
  });
});
