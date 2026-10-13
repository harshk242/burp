// Open Targets GraphQL Client with caching; retries run in the shared HTTP retry

import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { GraphQLError, OpenTargetsAPIError } from './exceptions.js';
import { filterNoneValues, generateCacheKey } from './utils.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { isRetryableTransportOr5xx } from '../../shared/http-retry-classify.js';
import type { CacheEntry, GraphQLResponse, GraphQLError as GraphQLErrorType } from './types.js';

export const OPEN_TARGETS_GRAPHQL_URL = 'https://api.platform.opentargets.org/api/v4/graphql';
const DEFAULT_CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second

// ── Retry policy ────────────────────────────────────────────────────────────

/** Waits of `2^n × baseMs` before retry n+1 (1s, 2s with the default base). */
function exponentialBackoff(baseMs: number): (attempt: number) => number {
  return (attempt) => 2 ** (attempt - 1) * baseMs;
}

/**
 * Production retry policy (plans/shared-http-retry-plan.md, "Platform
 * inventory"): 3 attempts, `2^n × retryDelay` backoff, retry on network/5xx
 * and transport timeouts, 429 retried with the same backoff (Retry-After
 * ignored), any other 4xx (HTTP 408 included) fails at once, 40s request
 * budget. GraphQL errors arrive in a 200 body and are handled outside the
 * retry, so they are never retried.
 */
export const OPEN_TARGETS_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_RETRIES,
  backoffMs: exponentialBackoff(DEFAULT_RETRY_DELAY),
  retryOn: isRetryableTransportOr5xx,
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'retry',
});

export interface OpenTargetsHttpOptions {
  /** GraphQL endpoint (default OPEN_TARGETS_GRAPHQL_URL). */
  baseUrl?: string;
  /** Retry policy (default OPEN_TARGETS_POLICY). */
  policy?: RetryPolicy;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}

/** An Open Targets GraphQL Axios instance with the shared retry attached. */
export function createOpenTargetsHttp(options: OpenTargetsHttpOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: options.baseUrl ?? OPEN_TARGETS_GRAPHQL_URL,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000, // 30 seconds
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? OPEN_TARGETS_POLICY, 'open-targets', options.retryDeps);
}

export interface OpenTargetsClientOptions {
  baseUrl?: string;
  cacheTtl?: number;
  /** Total attempts per request (default 3). */
  maxRetries?: number;
  /** Backoff base: waits of `2^n × retryDelay` ms (default 1000). */
  retryDelay?: number;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}

export class OpenTargetsClient {
  private readonly baseUrl: string;
  private readonly cacheTtl: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly cache: Map<string, CacheEntry>;
  private readonly axiosInstance: AxiosInstance;

  constructor(options: OpenTargetsClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.OPEN_TARGETS_API_URL || OPEN_TARGETS_GRAPHQL_URL;
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();

    this.axiosInstance = createOpenTargetsHttp({
      baseUrl: this.baseUrl,
      policy: {
        ...OPEN_TARGETS_POLICY,
        maxAttempts: this.maxRetries,
        backoffMs: exponentialBackoff(this.retryDelay),
      },
      adapter: options.adapter,
      retryDeps: options.retryDeps,
    });
  }

  /**
   * Execute a GraphQL query with caching. Only the HTTP request is retried
   * (in the shared retry adapter); GraphQL errors and empty `data` are not.
   */
  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    // Filter out null/undefined values
    const cleanVariables = variables ? filterNoneValues(variables) : undefined;

    // Check cache
    const cacheKey = generateCacheKey(query, cleanVariables);
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return cachedEntry.data as T;
    }

    const response = await this.axiosInstance.post<GraphQLResponse<T>>(
      '',
      {
        query,
        variables: cleanVariables,
      }
    );

    const { data, errors } = response.data;

    // Handle GraphQL errors
    if (errors && errors.length > 0) {
      // If we have partial data, log the warning but continue
      if (data) {
        console.warn('GraphQL returned partial data with errors:', errors);
      } else {
        throw new GraphQLError(
          `GraphQL query failed: ${errors.map((e: GraphQLErrorType) => e.message).join(', ')}`,
          errors.map((e: GraphQLErrorType) => ({ message: e.message, path: e.path as string[] }))
        );
      }
    }

    if (!data) {
      throw new OpenTargetsAPIError('No data returned from GraphQL query');
    }

    // Cache the result
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data as T;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: this.cache.size,
    };
  }
}

// Global client instance
let _client: OpenTargetsClient | null = null;

/**
 * Initialize the global client
 */
export function initializeClient(options?: OpenTargetsClientOptions): OpenTargetsClient {
  _client = new OpenTargetsClient(options);
  return _client;
}

/**
 * Get the global client instance
 */
export function getClient(): OpenTargetsClient {
  if (!_client) {
    throw new Error(
      'OpenTargetsClient not initialized. Call initializeClient() first.'
    );
  }
  return _client;
}

/**
 * Close the global client (cleanup)
 */
export function closeClient(): void {
  if (_client) {
    _client.clearCache();
    _client = null;
  }
}
