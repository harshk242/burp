/**
 * Pre-run cost estimate per arm (plan 2.4), from dataset size only: turns ×
 * repeats × an assumed per-turn token profile, priced with the arm model's
 * configured rates (usage.ts, so a long-context tier applies when the assumed
 * prompt crosses it). Rough by design: printed before the run so an expensive
 * matrix is visible up front; the hard limit is still --max-cost-usd.
 */
import type { Effort } from "../../server/llm";
import { priceCall } from "../../server/usage";

/** The assumed shape of one turn. Output grows with effort (thinking counts as output). */
export const ESTIMATE_PROFILE = {
  callsPerTurn: 4,
  promptTokensPerCall: 30_000,
  /** Share of the prompt read from cache / written to the 5m cache; the rest is uncached. */
  cacheReadShare: 0.85,
  cacheWriteShare: 0.1,
  outputTokensPerCall: { low: 800, medium: 1_500, high: 3_000, xhigh: 5_000, max: 8_000 } satisfies Record<Effort, number>,
} as const;

export interface ArmEstimateInput {
  provider: string;
  model: string;
  effort: Effort;
  maxOutputTokens: number;
  /** Turns per run (sum of the items' turns). */
  turns: number;
  items: number;
  repeat: number;
}

export interface ArmEstimate {
  perItemUsd: number;
  totalUsd: number;
}

export function estimateArmCost(a: ArmEstimateInput): ArmEstimate {
  const p = ESTIMATE_PROFILE;
  const cacheRead = Math.round(p.promptTokensPerCall * p.cacheReadShare);
  const cacheWrite = Math.round(p.promptTokensPerCall * p.cacheWriteShare);
  const call = priceCall(a.provider, a.model, {
    noCacheTokens: p.promptTokensPerCall - cacheRead - cacheWrite,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: cacheWrite,
    cacheWrite1hTokens: 0,
    outputTokens: Math.min(p.outputTokensPerCall[a.effort], a.maxOutputTokens),
  });
  const totalUsd = (call.costPicoUsd / 1e12) * p.callsPerTurn * a.turns * a.repeat;
  return { perItemUsd: a.items ? totalUsd / (a.items * a.repeat) : 0, totalUsd };
}
