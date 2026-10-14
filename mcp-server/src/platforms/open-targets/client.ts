import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { GraphQLError, OpenTargetsAPIError } from './exceptions.js';
import { filterNoneValues, generateCacheKey } from './utils.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { isRetryableTransportOr5xx } from '../../shared/http-retry-classify.js';
import type { CacheEntry, GraphQLResponse, GraphQLError as GraphQLErrorType } from './types.js';

export const OPEN_TARGETS_GRAPHQL_URL = 'https://api.platform.opentargets.org/api/v4/graphql';
const DEFAULT_CACHE_TTL = 3600 * 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

function exponentialBackoff(baseMs: number): (attempt: number) => number {
  return (attempt) => 2 ** (attempt - 1) * baseMs;
}

export const OPEN_TARGETS_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_RETRIES,
  backoffMs: exponentialBackoff(DEFAULT_RETRY_DELAY),
  retryOn: isRetryableTransportOr5xx,
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'retry',
});

export interface OpenTargetsHttpOptions {
  baseUrl?: string;
  policy?: RetryPolicy;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

export function createOpenTargetsHttp(options: OpenTargetsHttpOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: options.baseUrl ?? OPEN_TARGETS_GRAPHQL_URL,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? OPEN_TARGETS_POLICY, 'open-targets', options.retryDeps);
}

export interface OpenTargetsClientOptions {
  baseUrl?: string;
  cacheTtl?: number;
  maxRetries?: number;
  retryDelay?: number;
  adapter?: AxiosAdapter;
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

  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const cleanVariables = variables ? filterNoneValues(variables) : undefined;

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

    if (errors && errors.length > 0) {
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

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data as T;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: this.cache.size,
    };
  }
}

let _client: OpenTargetsClient | null = null;

export function initializeClient(options?: OpenTargetsClientOptions): OpenTargetsClient {
  _client = new OpenTargetsClient(options);
  return _client;
}

export function getClient(): OpenTargetsClient {
  if (!_client) {
    throw new Error(
      'OpenTargetsClient not initialized. Call initializeClient() first.'
    );
  }
  return _client;
}

export function closeClient(): void {
  if (_client) {
    _client.clearCache();
    _client = null;
  }
}
