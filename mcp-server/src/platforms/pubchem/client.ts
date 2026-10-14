import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { PUBCHEM_PUG_REST_BASE_URL } from './endpoints.js';

export const PUBCHEM_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoffMs: [0],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
});

export interface PubChemClientOptions {
  policy?: RetryPolicy;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

export function createPubChemClient(options: PubChemClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: PUBCHEM_PUG_REST_BASE_URL,
    timeout: 30_000,
    headers: {
      'User-Agent': 'PubChem-MCP-Server/1.0.0',
      Accept: 'application/json',
    },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? PUBCHEM_POLICY, 'pubchem', options.retryDeps);
}

let client: AxiosInstance | null = null;

export function initClient(_env: Record<string, string | undefined>, options: PubChemClientOptions = {}): void {
  client = createPubChemClient(options);
}

export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('PubChem API client not initialised – call initClient() first');
  }
  return client;
}

export function cleanupClient(): void {
  client = null;
}
