"use client";

import { useAuth } from "@/lib/auth";
import { useMemo } from "react";
import { buildApiUrl } from "@/lib/api-url";
import { errorField } from "@/lib/http-error";
import { parseResponse, type ResponseSchema } from "@/lib/api-schemas";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * Authenticated API calls. A call given a response schema returns the body parsed with it (a
 * mismatch throws); a call without one returns the body as `unknown`, for callers that ignore it.
 */
export function useApi() {
  const { getToken } = useAuth();

  return useMemo(() => {
    async function request(path: string, options?: RequestInit): Promise<unknown> {
      const token = await getToken();

      const headers = new Headers({ "Content-Type": "application/json" });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      new Headers(options?.headers).forEach((value, key) => headers.set(key, value));

      const res = await fetch(buildApiUrl(path, API_BASE), { ...options, headers });

      if (!res.ok) {
        const error: unknown = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errorField(error) || `HTTP ${res.status}`);
      }

      const body: unknown = await res.json();
      return body;
    }

    async function call<T>(path: string, schema: ResponseSchema<T> | undefined, options?: RequestInit): Promise<unknown> {
      const body = await request(path, options);
      return schema ? parseResponse(schema, body, path) : body;
    }

    function get<T>(path: string, schema: ResponseSchema<T>, options?: RequestInit): Promise<T>;
    function get(path: string, schema?: undefined, options?: RequestInit): Promise<unknown>;
    function get<T>(path: string, schema?: ResponseSchema<T>, options?: RequestInit): Promise<unknown> {
      return call(path, schema, options);
    }

    function post<T>(path: string, body: unknown, schema: ResponseSchema<T>, options?: RequestInit): Promise<T>;
    function post(path: string, body?: unknown, schema?: undefined, options?: RequestInit): Promise<unknown>;
    function post<T>(path: string, body?: unknown, schema?: ResponseSchema<T>, options?: RequestInit): Promise<unknown> {
      return call(path, schema, { ...options, method: "POST", body: JSON.stringify(body) });
    }

    function put<T>(path: string, body: unknown, schema: ResponseSchema<T>): Promise<T>;
    function put(path: string, body?: unknown): Promise<unknown>;
    function put<T>(path: string, body?: unknown, schema?: ResponseSchema<T>): Promise<unknown> {
      return call(path, schema, { method: "PUT", body: JSON.stringify(body) });
    }

    function patch<T>(path: string, body: unknown, schema: ResponseSchema<T>): Promise<T>;
    function patch(path: string, body?: unknown): Promise<unknown>;
    function patch<T>(path: string, body?: unknown, schema?: ResponseSchema<T>): Promise<unknown> {
      return call(path, schema, { method: "PATCH", body: JSON.stringify(body) });
    }

    function del<T>(path: string, schema: ResponseSchema<T>): Promise<T>;
    function del(path: string): Promise<unknown>;
    function del<T>(path: string, schema?: ResponseSchema<T>): Promise<unknown> {
      return call(path, schema, { method: "DELETE" });
    }

    return { get, post, put, patch, delete: del };
  }, [getToken]);
}
