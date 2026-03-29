// Open Targets GraphQL Client with caching and retry logic

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  NetworkError,
  GraphQLError,
  OpenTargetsAPIError,
} from './exceptions.js';
import {
  filterNoneValues,
  generateCacheKey,
  sleep,
  calculateBackoff,
  isRetryableStatus,
} from './utils.js';
import type { CacheEntry, GraphQLResponse, GraphQLError as GraphQLErrorType } from './types.js';

const DEFAULT_BASE_URL = 'https://api.platform.opentargets.org/api/v4/graphql';
const DEFAULT_CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second

export interface OpenTargetsClientOptions {
  baseUrl?: string;
  cacheTtl?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class OpenTargetsClient {
  private readonly baseUrl: string;
  private readonly cacheTtl: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly cache: Map<string, CacheEntry>;
  private axiosInstance: AxiosInstance;

  constructor(options: OpenTargetsClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.OPEN_TARGETS_API_URL || DEFAULT_BASE_URL;
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000, // 30 seconds
    });
  }

  /**
   * Execute a GraphQL query with caching and retry logic
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

    // Execute query with retries
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
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
      } catch (error) {
        lastError = error as Error;

        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          const status = axiosError.response?.status;

          // Don't retry non-retryable errors
          if (status && !isRetryableStatus(status)) {
            throw new NetworkError(
              `HTTP error ${status}: ${axiosError.message}`,
              status
            );
          }

          // Retry with exponential backoff
          if (attempt < this.maxRetries - 1) {
            const delay = calculateBackoff(attempt, this.retryDelay);
            console.warn(
              `Request failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delay}ms...`
            );
            await sleep(delay);
          }
        } else if (error instanceof GraphQLError || error instanceof OpenTargetsAPIError) {
          throw error;
        }
      }
    }

    // All retries exhausted
    throw lastError || new NetworkError('Request failed after all retries');
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
