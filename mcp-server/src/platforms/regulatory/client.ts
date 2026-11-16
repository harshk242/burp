import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';

export const OPENFDA_BASE_URL = 'https://api.fda.gov';
export const EMA_BASE_URL = 'https://www.ema.europa.eu';
export const EMA_MEDICINES_PATH = '/en/documents/report/medicines-output-medicines_json-report_en.json';

// openFDA returns occasional transient HTTP 500s that succeed on the next try.
export const OPENFDA_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  backoffMs: [1_000, 2_500],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'wait',
  maxRetryAfterMs: 5_000,
});

export const EMA_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 2,
  backoffMs: [1_000],
  totalBudgetMs: 50_000,
  perAttemptTimeoutMs: 40_000,
});

export interface RegulatoryClientOptions {
  openFdaPolicy?: RetryPolicy;
  emaPolicy?: RetryPolicy;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

export interface RegulatoryClients {
  openFda: AxiosInstance;
  ema: AxiosInstance;
  openFdaApiKey: string | undefined;
}

// openFDA answers a search with no hits with HTTP 404 and `error.code: NOT_FOUND`;
// that is an empty result, not a failure.
const acceptNotFound = (status: number) => (status >= 200 && status < 300) || status === 404;

export function createOpenFdaHttp(options: RegulatoryClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: OPENFDA_BASE_URL,
    timeout: 30_000,
    validateStatus: acceptNotFound,
    headers: { 'User-Agent': 'Regulatory-MCP-Server/1.0.0' },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.openFdaPolicy ?? OPENFDA_POLICY, 'openfda', options.retryDeps);
}

export function createEmaHttp(options: RegulatoryClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: EMA_BASE_URL,
    timeout: 40_000,
    headers: { 'User-Agent': 'Regulatory-MCP-Server/1.0.0', Accept: 'application/json' },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.emaPolicy ?? EMA_POLICY, 'ema', options.retryDeps);
}

let clients: RegulatoryClients | null = null;
const resetHooks: (() => void)[] = [];

/** Modules holding per-client caches register here so a client reset also drops them. */
export function onClientReset(hook: () => void): void {
  resetHooks.push(hook);
}

export function initClient(env: Record<string, string | undefined>, options: RegulatoryClientOptions = {}): void {
  resetClient();
  clients = {
    openFda: createOpenFdaHttp(options),
    ema: createEmaHttp(options),
    openFdaApiKey: env.OPENFDA_API_KEY || undefined,
  };
}

export function getClients(): RegulatoryClients {
  if (!clients) {
    throw new Error('Regulatory API clients not initialised – call initClient() first');
  }
  return clients;
}

export function resetClient(): void {
  clients = null;
  for (const hook of resetHooks) hook();
}
