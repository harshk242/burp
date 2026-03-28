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
}

/**
 * Fetches usage info on mount and re-fetches each time streaming ends.
 */
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
      };
      setUsage(info);
    } catch {
      // Silently ignore — usage indicator just stays stale
    }
  }, [get, setUsage, user]);

  // Fetch on mount
  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Re-fetch when streaming ends (isStreaming goes from true → false)
  useEffect(() => {
    if (!isStreaming) {
      fetchUsage();
    }
  }, [isStreaming, fetchUsage]);

  return { fetchUsage };
}
