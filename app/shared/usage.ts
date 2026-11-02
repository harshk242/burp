import type { UnlimitedOrNonnegative } from "./limits";

export type EpochSeconds = number;

export interface TokenUsageInfo {
  used_today: number;
  limit: UnlimitedOrNonnegative;
  remaining: UnlimitedOrNonnegative;
  input_today: number;
  output_today: number;
}

export interface CostUsageInfo {
  daily_used_microusd: number;
  daily_limit_microusd: UnlimitedOrNonnegative;
  daily_remaining_microusd: UnlimitedOrNonnegative;
  daily_reset_at: EpochSeconds;
  monthly_used_microusd: number;
  monthly_limit_microusd: UnlimitedOrNonnegative;
  monthly_remaining_microusd: UnlimitedOrNonnegative;
  monthly_reset_at: EpochSeconds;
}

export interface UsageResponse {
  used: number;
  limit: UnlimitedOrNonnegative;
  remaining: UnlimitedOrNonnegative;
  resetAt: EpochSeconds;
  total_queries: number;
  role: "waitlist" | "user" | "admin";
  tokens: TokenUsageInfo;
  cost: CostUsageInfo;
}

export type UsageInfo = Omit<UsageResponse, "total_queries" | "role">;
