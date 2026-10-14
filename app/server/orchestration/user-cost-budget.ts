import { usageEventQueries } from "../db";
import type { EffectiveLimits } from "../usage";
import { TurnError } from "./chat-turn";
import type { CostBudget } from "./cost-budget";

const PICO_USD_PER_MICRO_USD = 1_000_000;
type CostLimits = Pick<EffectiveLimits, "daily_cost_limit_microusd" | "monthly_cost_limit_microusd">;
type Ledger = Pick<typeof usageEventQueries, "getTotalsForDate" | "getTotalsForMonth">;

export class UserCostBudgetRegistry {
  private readonly inFlight = new Map<string, Set<UserCostBudget>>();

  constructor(private readonly ledger: Ledger = usageEventQueries) {}

  acquire(userId: string, limits: CostLimits): UserCostBudget {
    const budget = new UserCostBudget(this, userId, limits);
    const budgets = this.inFlight.get(userId) ?? new Set<UserCostBudget>();
    budgets.add(budget);
    this.inFlight.set(userId, budgets);
    return budget;
  }

  check(userId: string, limits: CostLimits): void {
    const pending = [...(this.inFlight.get(userId) ?? [])].reduce((sum, budget) => sum + budget.spentPicoUsd, 0);
    const periods = [
      { limit: limits.daily_cost_limit_microusd, used: () => this.ledger.getTotalsForDate(userId).cost_microusd,
        message: "You have used your daily dollar budget. Limits reset at midnight UTC." },
      { limit: limits.monthly_cost_limit_microusd, used: () => this.ledger.getTotalsForMonth(userId).cost_microusd,
        message: "You have used your monthly dollar budget. Limits reset next month." },
    ];
    for (const period of periods) {
      if (period.limit !== -1 && period.used() * PICO_USD_PER_MICRO_USD + pending >= period.limit * PICO_USD_PER_MICRO_USD) {
        throw new TurnError("budget_exceeded", period.message);
      }
    }
  }

  release(userId: string, budget: UserCostBudget): void {
    const budgets = this.inFlight.get(userId);
    budgets?.delete(budget);
    if (budgets?.size === 0) this.inFlight.delete(userId);
  }
}

export class UserCostBudget implements CostBudget {
  spentPicoUsd = 0;
  private released = false;

  constructor(
    private readonly registry: UserCostBudgetRegistry,
    private readonly userId: string,
    private readonly limits: CostLimits,
  ) {}

  charge(picoUsd: number): void {
    if (!this.released && Number.isFinite(picoUsd) && picoUsd > 0) this.spentPicoUsd += picoUsd;
  }

  check(): void {
    this.registry.check(this.userId, this.limits);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.registry.release(this.userId, this);
  }
}

export const userCostBudgets = new UserCostBudgetRegistry();
