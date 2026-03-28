import { create } from "zustand";
import type { User } from "@/types";

export interface UsageInfo {
  used: number;
  limit: number;       // -1 = unlimited
  remaining: number;   // -1 = unlimited
  resetAt: number;     // Unix timestamp of next midnight UTC
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
