import { describe, expect, it } from "bun:test";
import { UserCostBudgetRegistry } from "../orchestration/user-cost-budget";

const totals = (cost_microusd: number) => ({ cost_microusd, input_tokens: 0, output_tokens: 0, query_count: 0 });
const limits = (daily: number, monthly = -1) => ({ daily_cost_limit_microusd: daily, monthly_cost_limit_microusd: monthly });

function fixture() {
  const spend = { daily: 0, monthly: 0 };
  const registry = new UserCostBudgetRegistry({
    getTotalsForDate: () => totals(spend.daily),
    getTotalsForMonth: () => totals(spend.monthly),
  });
  return { spend, registry };
}

describe("per-user cost budgets", () => {
  it("combines ledger and precise in-flight charges for daily and monthly caps", () => {
    const { spend, registry } = fixture();
    spend.daily = 9;
    spend.monthly = 99;
    for (const cap of [limits(10), limits(-1, 100)]) {
      const turn = registry.acquire("user", cap);
      turn.check();
      turn.charge(999_999);
      turn.check();
      turn.charge(1);
      expect(() => turn.check()).toThrow("dollar budget");
      turn.release();
    }
  });

  it("concurrent turns share one user's remaining spend and isolate other users", () => {
    const { registry } = fixture();
    const first = registry.acquire("user", limits(10));
    const second = registry.acquire("user", limits(10));
    first.check();
    second.check();
    first.charge(6e6);
    second.charge(4e6);
    expect(() => first.check()).toThrow("daily dollar budget");
    expect(() => second.check()).toThrow("daily dollar budget");
    expect(() => registry.acquire("other", limits(10)).check()).not.toThrow();
  });

  it("unlimited periods ignore both recorded and in-flight spend", () => {
    const { spend, registry } = fixture();
    spend.daily = spend.monthly = 1e9;
    const turn = registry.acquire("user", limits(-1, -1));
    turn.charge(1e12);
    expect(() => turn.check()).not.toThrow();
  });

  it("release removes in-flight spend once and fresh ledger reads avoid double counting", () => {
    const { spend, registry } = fixture();
    const first = registry.acquire("user", limits(10));
    const second = registry.acquire("user", limits(10));
    first.charge(6e6);
    spend.daily = 6;
    first.release();
    first.release();
    second.check();
    second.charge(4e6);
    expect(() => second.check()).toThrow("daily dollar budget");
    second.release();
    expect(() => registry.acquire("user", limits(10)).check()).not.toThrow();
  });
});
