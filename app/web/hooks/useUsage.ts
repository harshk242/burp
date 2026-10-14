"use client";

import { useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { useUserStore, type UsageInfo } from "@/stores/userStore";
import { useChatStore } from "@/stores/chatStore";

import type { UsageResponse } from "../../shared/usage";

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
