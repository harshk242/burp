import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';

export const UNIPROT_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoffMs: [0],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
});

export const UNIPROT_BASE_URL = 'https://rest.uniprot.org';

export interface UniProtClientOptions {
  policy?: RetryPolicy;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

export function createUniProtClient(options: UniProtClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: UNIPROT_BASE_URL,
    timeout: 30_000,
    headers: {
      'User-Agent': 'UniProt-MCP-Server/1.0.0',
    },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? UNIPROT_POLICY, 'uniprot', options.retryDeps);
}

let client: AxiosInstance | null = null;

export function initClient(_env: Record<string, string | undefined>, options: UniProtClientOptions = {}): void {
  client = createUniProtClient(options);
}

export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('UniProt API client not initialised – call initClient() first');
  }
  return client;
}

export function cleanupClient(): void {
  client = null;
}
