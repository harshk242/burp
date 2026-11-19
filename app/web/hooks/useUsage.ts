"use client";

import { useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { useUserStore, type UsageInfo } from "@/stores/userStore";
import { useChatStore } from "@/stores/chatStore";

import { usageResponseSchema } from "@/lib/api-schemas";

export function useUsage() {
  const { get } = useApi();
  const setUsage = useUserStore((s) => s.setUsage);
  const user = useUserStore((s) => s.user);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const fetchUsage = useCallback(async () => {
    if (!user) return;
    try {
      const data = await get("/usage", usageResponseSchema);
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
    void fetchUsage();
  }, [fetchUsage]);

  useEffect(() => {
    if (!isStreaming) {
      void fetchUsage();
    }
  }, [isStreaming, fetchUsage]);

  return { fetchUsage };
}
