import { create } from "zustand";
import type { User } from "@/types";

import type { UsageInfo } from "../../shared/usage";
export type { TokenUsageInfo, CostUsageInfo, UsageInfo } from "../../shared/usage";

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
