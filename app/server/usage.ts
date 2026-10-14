import { appConfig, type AppConfig, type ModelPricing } from "./config";

export const MICROUSD_PER_USD = 1_000_000;
const PICOUSD_PER_MICROUSD = 1_000_000;

export class PricingConfigError extends Error {
  constructor(provider: string, model: string) {
    super(`Missing usage pricing for active chat model ${provider}/${model}`);
    this.name = "PricingConfigError";
  }
}

export function usdToMicrousd(usd: number): number {
  return Math.round(usd * MICROUSD_PER_USD);
}

export function defaultCostLimitMicrousd(usdLimit: number, isAdmin: boolean): number {
  if (isAdmin) return -1;
  if (usdLimit === -1) return -1;
  return usdToMicrousd(usdLimit);
}

export interface EffectiveLimits {
  daily_query_limit: number;
  daily_token_limit: number;
  daily_cost_limit_microusd: number;
  monthly_cost_limit_microusd: number;
}

type LimitOverrides = {
  daily_query_limit?: number | null;
  daily_token_limit?: number | null;
  daily_cost_limit_microusd?: number | null;
  monthly_cost_limit_microusd?: number | null;
};

export function resolveEffectiveLimits(
  user: LimitOverrides,
  role: string,
  roleQueryLimit: number,
  config: Pick<AppConfig, "rate_limits" | "usage"> = appConfig
): EffectiveLimits {
  const isAdmin = role === "admin";
  return {
    daily_query_limit: user.daily_query_limit ?? roleQueryLimit,
    daily_token_limit: user.daily_token_limit ?? (isAdmin ? -1 : config.rate_limits.default_daily_tokens),
    daily_cost_limit_microusd:
      user.daily_cost_limit_microusd ??
      defaultCostLimitMicrousd(config.usage.default_daily_cost_limit_usd, isAdmin),
    monthly_cost_limit_microusd:
      user.monthly_cost_limit_microusd ??
      defaultCostLimitMicrousd(config.usage.default_monthly_cost_limit_usd, isAdmin),
  };
}

export function getRemainingMicrousd(limitMicrousd: number, usedMicrousd: number): number {
  return limitMicrousd === -1 ? -1 : Math.max(0, limitMicrousd - usedMicrousd);
}

export function getUtcDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function getNextUtcMidnight(date = new Date()): number {
  const resetDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  );
  return Math.floor(resetDate.getTime() / 1000);
}

export function getNextUtcMonthStart(date = new Date()): number {
  const resetDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return Math.floor(resetDate.getTime() / 1000);
}

export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface ResolvedPricing {
  base: Rates;
  longContext: (Rates & { aboveInputTokens: number }) | null;
  entry: ModelPricing;
}

export interface CallUsage {
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number;
}

export type PricingTier = "base" | "long_context";

export interface CallCost extends CallUsage {
  promptTokens: number;
  tier: PricingTier;
  inputCostPicoUsd: number;
  cacheReadCostPicoUsd: number;
  cacheWriteCostPicoUsd: number;
  outputCostPicoUsd: number;
  costPicoUsd: number;
}

export interface ChatCost {
  llmCalls: number;
  longContextCalls: number;
  inputTokens: number;
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number;
  inputCostMicrousd: number;
  cacheReadCostMicrousd: number;
  cacheWriteCostMicrousd: number;
  outputCostMicrousd: number;
  costPicoUsd: number;
  costMicrousd: number;
}

function safe(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Cost overflow: ${what} = ${value} is not a safe integer`);
  }
  return value;
}

function toRates(set: {
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  cache_read_usd_per_mtok?: number;
  cache_write_5m_usd_per_mtok?: number;
  cache_write_1h_usd_per_mtok?: number;
}): Rates {
  const input = usdToMicrousd(set.input_usd_per_mtok);
  return {
    input,
    output: usdToMicrousd(set.output_usd_per_mtok),
    cacheRead: set.cache_read_usd_per_mtok !== undefined ? usdToMicrousd(set.cache_read_usd_per_mtok) : input,
    cacheWrite5m:
      set.cache_write_5m_usd_per_mtok !== undefined
        ? usdToMicrousd(set.cache_write_5m_usd_per_mtok)
        : Math.ceil((input * 5) / 4),
    cacheWrite1h:
      set.cache_write_1h_usd_per_mtok !== undefined ? usdToMicrousd(set.cache_write_1h_usd_per_mtok) : input * 2,
  };
}

export function resolvePricing(provider: string, model: string, config: AppConfig = appConfig): ResolvedPricing {
  const entry = config.usage.pricing[provider]?.[model];
  if (!entry) {
    throw new PricingConfigError(provider, model);
  }
  const lc = entry.long_context;
  return {
    base: toRates(entry),
    longContext: lc ? { ...toRates(lc), aboveInputTokens: lc.above_input_tokens } : null,
    entry,
  };
}

export function assertPricingConfigured(provider: string, model: string, config: AppConfig = appConfig): void {
  resolvePricing(provider, model, config);
}

function tokenCount(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Invalid token count: ${what} = ${value}`);
  }
  return value;
}

export function priceCall(
  provider: string,
  model: string,
  usage: CallUsage,
  config: AppConfig = appConfig
): CallCost {
  const pricing = resolvePricing(provider, model, config);
  const noCacheTokens = tokenCount(usage.noCacheTokens, "noCacheTokens");
  const cacheReadTokens = tokenCount(usage.cacheReadTokens, "cacheReadTokens");
  const cacheWrite5mTokens = tokenCount(usage.cacheWrite5mTokens, "cacheWrite5mTokens");
  const cacheWrite1hTokens = tokenCount(usage.cacheWrite1hTokens, "cacheWrite1hTokens");
  const outputTokens = tokenCount(usage.outputTokens, "outputTokens");
  const promptTokens = safe(noCacheTokens + cacheReadTokens + cacheWrite5mTokens + cacheWrite1hTokens, "promptTokens");

  const lc = pricing.longContext;
  const tier: PricingTier = lc && promptTokens > lc.aboveInputTokens ? "long_context" : "base";
  const rates = tier === "long_context" && lc ? lc : pricing.base;

  const inputCostPicoUsd = safe(noCacheTokens * rates.input, "input cost");
  const cacheReadCostPicoUsd = safe(cacheReadTokens * rates.cacheRead, "cache read cost");
  const cacheWriteCostPicoUsd = safe(
    safe(cacheWrite5mTokens * rates.cacheWrite5m, "cache write 5m cost") +
      safe(cacheWrite1hTokens * rates.cacheWrite1h, "cache write 1h cost"),
    "cache write cost"
  );
  const outputCostPicoUsd = safe(outputTokens * rates.output, "output cost");

  return {
    noCacheTokens,
    cacheReadTokens,
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    outputTokens,
    promptTokens,
    tier,
    inputCostPicoUsd,
    cacheReadCostPicoUsd,
    cacheWriteCostPicoUsd,
    outputCostPicoUsd,
    costPicoUsd: safe(inputCostPicoUsd + cacheReadCostPicoUsd + cacheWriteCostPicoUsd + outputCostPicoUsd, "call cost"),
  };
}

function picoToMicrousdFloor(pico: number): number {
  return (pico - (pico % PICOUSD_PER_MICROUSD)) / PICOUSD_PER_MICROUSD;
}

export function summarizeTurnCost(calls: readonly CallCost[]): ChatCost {
  const sum = (pick: (call: CallCost) => number, what: string) =>
    calls.reduce((total, call) => safe(total + pick(call), what), 0);

  const noCacheTokens = sum((c) => c.noCacheTokens, "noCacheTokens");
  const cacheReadTokens = sum((c) => c.cacheReadTokens, "cacheReadTokens");
  const cacheWrite5mTokens = sum((c) => c.cacheWrite5mTokens, "cacheWrite5mTokens");
  const cacheWrite1hTokens = sum((c) => c.cacheWrite1hTokens, "cacheWrite1hTokens");
  const costPicoUsd = sum((c) => c.costPicoUsd, "turn cost");

  return {
    llmCalls: calls.length,
    longContextCalls: calls.filter((c) => c.tier === "long_context").length,
    inputTokens: safe(noCacheTokens + cacheReadTokens + cacheWrite5mTokens + cacheWrite1hTokens, "inputTokens"),
    noCacheTokens,
    cacheReadTokens,
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    outputTokens: sum((c) => c.outputTokens, "outputTokens"),
    inputCostMicrousd: picoToMicrousdFloor(sum((c) => c.inputCostPicoUsd, "input cost")),
    cacheReadCostMicrousd: picoToMicrousdFloor(sum((c) => c.cacheReadCostPicoUsd, "cache read cost")),
    cacheWriteCostMicrousd: picoToMicrousdFloor(sum((c) => c.cacheWriteCostPicoUsd, "cache write cost")),
    outputCostMicrousd: picoToMicrousdFloor(sum((c) => c.outputCostPicoUsd, "output cost")),
    costPicoUsd,
    costMicrousd: picoToMicrousdFloor(costPicoUsd) + (costPicoUsd % PICOUSD_PER_MICROUSD === 0 ? 0 : 1),
  };
}
