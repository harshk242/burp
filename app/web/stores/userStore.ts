import { create } from "zustand";
import type { User } from "@/types";

export interface TokenUsageInfo {
  used_today: number;
  limit: number;       // -1 = unlimited
  remaining: number;   // -1 = unlimited
  input_today: number;
  output_today: number;
}

export interface CostUsageInfo {
  daily_used_microusd: number;
  daily_limit_microusd: number;       // -1 = unlimited
  daily_remaining_microusd: number;   // -1 = unlimited
  daily_reset_at: number;
  monthly_used_microusd: number;
  monthly_limit_microusd: number;     // -1 = unlimited
  monthly_remaining_microusd: number; // -1 = unlimited
  monthly_reset_at: number;
}

export interface UsageInfo {
  used: number;
  limit: number;       // -1 = unlimited
  remaining: number;   // -1 = unlimited
  resetAt: number;     // Unix timestamp of next midnight UTC
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
