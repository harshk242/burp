import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { attachRetry, type RetryDeps, type RetryPolicy } from './http-retry.js';
import { TokenBucketRateLimiter } from './rate-limiter.js';

export const NCBI_EUTILS_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';

/** Longest wait, in seconds, a full NCBI queue may cause before new requests fail fast. */
export const NCBI_MAX_QUEUE_WAIT_SECONDS = 10;

/**
 * NCBI E-utilities allow 3 req/s per IP without an API key and 10 req/s per key,
 * across all E-utilities and databases. A burst of one keeps any one-second
 * window within one request of that limit.
 *
 * Module-private: only `getSharedNcbiRateLimiter` may build one, so no caller can
 * end up with a second bucket for the same key.
 */
function createNcbiRateLimiter(hasApiKey: boolean): TokenBucketRateLimiter {
  const requestsPerSecond = hasApiKey ? 10 : 3;
  return new TokenBucketRateLimiter({
    requestsPerSecond,
    burstSize: 1,
    maxQueueLength: requestsPerSecond * NCBI_MAX_QUEUE_WAIT_SECONDS,
  });
}

const sharedNcbiLimiters = new Map<string, TokenBucketRateLimiter>();

/**
 * The process-wide NCBI limiter for an API key (or for keyless requests), shared
 * by every NCBI client (PubMed, ClinVar) because the limit covers them together.
 */
export function getSharedNcbiRateLimiter(apiKey: string | undefined): TokenBucketRateLimiter {
  const key = apiKey ?? '';
  let limiter = sharedNcbiLimiters.get(key);
  if (!limiter) {
    limiter = createNcbiRateLimiter(key !== '');
    sharedNcbiLimiters.set(key, limiter);
  }
  return limiter;
}

export interface NcbiHttpOptions {
  /** Platform name used in upstream error messages, e.g. 'pubmed'. */
  platform: string;
  /** The retry policy; the factory supplies `beforeAttempt` itself. */
  policy: Omit<RetryPolicy, 'beforeAttempt'>;
  /** The API key these requests send; it picks the shared bucket. */
  apiKey?: string | undefined;
  /** Test seam: a limiter to use instead of the shared one. */
  rateLimiter?: TokenBucketRateLimiter | undefined;
  adapter?: AxiosAdapter | undefined;
  retryDeps?: RetryDeps | undefined;
}

/**
 * The only way to build an HTTP client for NCBI E-utilities. Every attempt,
 * retries included, first takes a token from the shared NCBI limiter.
 */
export function createNcbiHttp(options: NcbiHttpOptions): AxiosInstance {
  const limiter = options.rateLimiter ?? getSharedNcbiRateLimiter(options.apiKey);
  const instance = axios.create({
    baseURL: NCBI_EUTILS_BASE_URL,
    timeout: 30000,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  const policy: RetryPolicy = {
    ...options.policy,
    beforeAttempt: (signal) => limiter.waitForToken(signal),
  };
  return attachRetry(instance, policy, options.platform, options.retryDeps);
}
