import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';

/**
 * Production retry policy (plans/shared-http-retry-plan.md, "Platform
 * inventory"): one attempt as before, now with a 40s request budget and the
 * tool-call deadline; failures surface as a structured `UpstreamError`.
 */
export const REACTOME_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoffMs: [0],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
});

export const REACTOME_BASE_URL = 'https://reactome.org/ContentService';

export interface ReactomeClientOptions {
  /** Retry policy (default REACTOME_POLICY). */
  policy?: RetryPolicy;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}

/** A Reactome Content Service client with the shared retry attached. */
export function createReactomeClient(options: ReactomeClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: REACTOME_BASE_URL,
    timeout: 30_000,
    headers: {
      'User-Agent': 'Reactome-MCP-Server/1.0.0',
      'Content-Type': 'application/json',
    },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? REACTOME_POLICY, 'reactome', options.retryDeps);
}

let client: AxiosInstance | null = null;

/**
 * Initialise (or re-initialise) the Reactome Content Service API client.
 * Called once from the platform module's `init()`.
 */
export function initClient(_env: Record<string, string | undefined>, options: ReactomeClientOptions = {}): void {
  client = createReactomeClient(options);
}

/** Return the shared Axios instance. Throws if called before `initClient`. */
export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('Reactome API client not initialised – call initClient() first');
  }
  return client;
}

/** Tear down the client (cancel pending requests, release references). */
export function cleanupClient(): void {
  client = null;
}
