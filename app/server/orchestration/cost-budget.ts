import { TurnError } from "./chat-turn";

export const PICO_USD_PER_USD = 1e12;

export interface CostBudget {
  charge(picoUsd: number): void;
  check(): void;
}

export class SharedCostBudget implements CostBudget {
  private spent = 0;

  constructor(private readonly limitPicoUsd: number) {}

  static usd(limitUsd: number): SharedCostBudget {
    return new SharedCostBudget(Math.round(limitUsd * PICO_USD_PER_USD));
  }

  charge(picoUsd: number): void {
    if (Number.isFinite(picoUsd) && picoUsd > 0) this.spent += picoUsd;
  }

  check(): void {
    if (this.exhausted) {
      throw new TurnError(
        "budget_exceeded",
        `Cost budget exhausted: spent $${this.spentUsd.toFixed(4)} of $${(this.limitPicoUsd / PICO_USD_PER_USD).toFixed(4)}`,
      );
    }
  }

  get exhausted(): boolean {
    return this.spent >= this.limitPicoUsd;
  }

  get spentUsd(): number {
    return this.spent / PICO_USD_PER_USD;
  }
}

export class TurnBudget {
  private charged = 0;

  constructor(private readonly budget: CostBudget | undefined) {}

  check(): void {
    this.budget?.check();
  }

  chargeCall(picoUsd: number): void {
    this.charged += picoUsd;
    this.budget?.charge(picoUsd);
  }

  reconcile(meterTotalPicoUsd: number): void {
    const rest = meterTotalPicoUsd - this.charged;
    if (rest <= 0) return;
    this.charged += rest;
    this.budget?.charge(rest);
  }
}
