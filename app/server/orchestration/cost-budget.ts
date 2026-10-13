/**
 * A cost cap shared by concurrent turns (the eval runner passes one to every
 * processChat). usage_events rows land only at turn end, so the cap is checked
 * between model calls instead:
 *
 * - `check()` runs before each model call and throws a `budget_exceeded`
 *   TurnError once the cap is reached;
 * - each metered call is charged right after it is priced, and the turn's
 *   `finally` charges whatever the meter holds beyond that (the cut-off
 *   estimate of a failed turn), so every priced call reaches the budget once.
 *
 * Calls already streaming finish, so the cap can be overshot by about one model
 * call per concurrent turn. Amounts are in picoUSD (exact integers).
 */

import { TurnError } from "./chat-turn";

export const PICO_USD_PER_USD = 1e12;

export interface CostBudget {
  /** Adds spent cost. Never throws (safe in `finally`). */
  charge(picoUsd: number): void;
  /** Throws a `budget_exceeded` TurnError once the cap is reached. */
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

/**
 * One turn's view of the shared budget: remembers what it charged so the
 * turn's `finally` charges only the rest of the meter's total.
 */
export class TurnBudget {
  private charged = 0;

  constructor(private readonly budget: CostBudget | undefined) {}

  check(): void {
    this.budget?.check();
  }

  /** Charges one metered call. */
  chargeCall(picoUsd: number): void {
    this.charged += picoUsd;
    this.budget?.charge(picoUsd);
  }

  /** Charges the meter's total minus what was charged per call (positive part only). */
  reconcile(meterTotalPicoUsd: number): void {
    const rest = meterTotalPicoUsd - this.charged;
    if (rest <= 0) return;
    this.charged += rest;
    this.budget?.charge(rest);
  }
}
