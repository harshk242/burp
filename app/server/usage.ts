import { appConfig, type AppConfig } from "./config";

export const MICROUSD_PER_USD = 1_000_000;
const TOKENS_PER_MTOK = 1_000_000;

export class PricingConfigError extends Error {
  constructor(provider: string, model: string) {
    super(`Missing usage pricing for active chat model ${provider}/${model}`);
    this.name = "PricingConfigError";
  }
}

export interface ChatCost {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCostPerMtokMicrousd: number;
  outputCostPerMtokMicrousd: number;
  costMicrousd: number;
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

/**
 * Resolve the limits actually applied to a user: per-user override, else the
 * role/config default. -1 = unlimited. `roleQueryLimit` comes from the
 * rate_limits table (rateLimitQueries.getForRole) so this stays DB-free.
 */
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

function getPricingEntry(provider: string, model: string, config: AppConfig = appConfig) {
  const pricing = config.usage.pricing[provider]?.[model];
  if (!pricing) {
    throw new PricingConfigError(provider, model);
  }
  return pricing;
}

function calculateTokenCostMicrousd(tokens: number, priceMicrousdPerMtok: number): number {
  if (tokens <= 0 || priceMicrousdPerMtok <= 0) return 0;
  return Math.ceil((tokens * priceMicrousdPerMtok) / TOKENS_PER_MTOK);
}

export function calculateChatCost(input: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  config?: AppConfig;
}): ChatCost {
  const pricing = getPricingEntry(input.provider, input.model, input.config);
  const inputCostPerMtokMicrousd = usdToMicrousd(pricing.input_usd_per_mtok);
  const outputCostPerMtokMicrousd = usdToMicrousd(pricing.output_usd_per_mtok);
  const inputCost = calculateTokenCostMicrousd(input.inputTokens, inputCostPerMtokMicrousd);
  const outputCost = calculateTokenCostMicrousd(input.outputTokens, outputCostPerMtokMicrousd);

  return {
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    inputCostPerMtokMicrousd,
    outputCostPerMtokMicrousd,
    costMicrousd: inputCost + outputCost,
  };
}
