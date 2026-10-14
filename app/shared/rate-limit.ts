export const RATE_LIMIT_ERROR_CODES = {
  query: "query_limit_exceeded",
  cost: "cost_limit_exceeded",
  pricing: "pricing_not_configured",
} as const;

export type RateLimitErrorCode = (typeof RATE_LIMIT_ERROR_CODES)[keyof typeof RATE_LIMIT_ERROR_CODES];

export function isRateLimitErrorCode(value: unknown): value is RateLimitErrorCode {
  return Object.values(RATE_LIMIT_ERROR_CODES).some((code) => code === value);
}
