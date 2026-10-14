import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';

export const REACTOME_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoffMs: [0],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
});

export const REACTOME_BASE_URL = 'https://reactome.org/ContentService';

export interface ReactomeClientOptions {
  policy?: RetryPolicy;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

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

export function initClient(_env: Record<string, string | undefined>, options: ReactomeClientOptions = {}): void {
  client = createReactomeClient(options);
}

export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('Reactome API client not initialised – call initClient() first');
  }
  return client;
}

export function cleanupClient(): void {
  client = null;
}
