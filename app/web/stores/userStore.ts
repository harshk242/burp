import { create } from "zustand";
import type { User } from "@/types";

export interface TokenUsageInfo {
  used_today: number;
  limit: number;
  remaining: number;
  input_today: number;
  output_today: number;
}

export interface CostUsageInfo {
  daily_used_microusd: number;
  daily_limit_microusd: number;
  daily_remaining_microusd: number;
  daily_reset_at: number;
  monthly_used_microusd: number;
  monthly_limit_microusd: number;
  monthly_remaining_microusd: number;
  monthly_reset_at: number;
}

export interface UsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
  tokens?: TokenUsageInfo;
  cost?: CostUsageInfo;
}

interface UserState {
  user: User | null;
  usage: UsageInfo | null;

  setUser: (user: User | null) => void;
  setUsage: (usage: UsageInfo | null) => void;
  reset: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  usage: null,

  setUser: (user) => set({ user }),
  setUsage: (usage) => set({ usage }),
  reset: () => set({ user: null, usage: null }),
}));
