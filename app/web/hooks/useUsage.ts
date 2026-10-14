"use client";

import { useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { useUserStore, type UsageInfo } from "@/stores/userStore";
import { useChatStore } from "@/stores/chatStore";

interface UsageResponse {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
  total_queries: number;
  role: string;
  tokens?: {
    used_today: number;
    limit: number;
    remaining: number;
    input_today: number;
    output_today: number;
  };
  cost?: {
    daily_used_microusd: number;
    daily_limit_microusd: number;
    daily_remaining_microusd: number;
    daily_reset_at: number;
    monthly_used_microusd: number;
    monthly_limit_microusd: number;
    monthly_remaining_microusd: number;
    monthly_reset_at: number;
  };
}

export function useUsage() {
  const { get } = useApi();
  const setUsage = useUserStore((s) => s.setUsage);
  const user = useUserStore((s) => s.user);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const fetchUsage = useCallback(async () => {
    if (!user) return;
    try {
      const data = await get<UsageResponse>("/usage");
      const info: UsageInfo = {
        used: data.used,
        limit: data.limit,
        remaining: data.remaining,
        resetAt: data.resetAt,
        tokens: data.tokens,
        cost: data.cost,
      };
      setUsage(info);
    } catch {
    }
  }, [get, setUsage, user]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  useEffect(() => {
    if (!isStreaming) {
      fetchUsage();
    }
  }, [isStreaming, fetchUsage]);

  return { fetchUsage };
}
