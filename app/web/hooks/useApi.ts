"use client";

import { useAuth } from "@clerk/clerk-react";
import { useCallback } from "react";
import { buildApiUrl } from "@/lib/api-url";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function useApi() {
  const { getToken } = useAuth();

  const request = useCallback(
    async <T>(path: string, options?: RequestInit): Promise<T> => {
      const token = await getToken();

      const res = await fetch(buildApiUrl(path, API_BASE), {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...options?.headers,
        },
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(error.error || `HTTP ${res.status}`);
      }

      return res.json();
    },
    [getToken]
  );

  const get = useCallback(
    <T>(path: string, options?: RequestInit) => request<T>(path, options),
    [request]
  );

  const post = useCallback(
    <T>(path: string, body?: unknown, options?: RequestInit) =>
      request<T>(path, { ...options, method: "POST", body: JSON.stringify(body) }),
    [request]
  );

  const put = useCallback(
    <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
    [request]
  );

  const patch = useCallback(
    <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    [request]
  );

  const del = useCallback(
    <T>(path: string) => request<T>(path, { method: "DELETE" }),
    [request]
  );

  return { get, post, put, patch, delete: del };
}
