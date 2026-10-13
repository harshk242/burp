// PubMed API Client with rate limiting and caching

import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { filterNoneValues, generateCacheKey } from './utils.js';
import {
  parseESearchResult,
  parseESummaryResult,
  parseEFetchResult,
  parseELinkResult,
} from './xml-parser.js';
import { TokenBucketRateLimiter, createNcbiRateLimiter } from '../../shared/rate-limiter.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { isRetryableTransportOr5xx } from '../../shared/http-retry-classify.js';
import type {
  CacheEntry,
  PubMedClientOptions,
  ESearchResult,
  ArticleSummary,
  PubMedArticle,
  LinkResult,
} from './types.js';

const NCBI_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const DEFAULT_CACHE_TTL = 3600 * 1000; // 1 hour
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

// ── Retry policy ────────────────────────────────────────────────────────────

/** Waits of `2^n × baseMs` before retry n+1 (1s, 2s with the default base). */
function exponentialBackoff(baseMs: number): (attempt: number) => number {
  return (attempt) => 2 ** (attempt - 1) * baseMs;
}

/**
 * Production retry policy (plans/shared-http-retry-plan.md, "Platform
 * inventory"): 3 attempts, `2^n × retryDelay` backoff, retry on network/5xx
 * and transport timeouts (any other 4xx, HTTP 408 included, fails at once),
 * 429 fails fast with Retry-After (default 5s), 40s request budget. The
 * client adds the NCBI token bucket as `beforeAttempt`.
 */
export const PUBMED_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_RETRIES,
  backoffMs: exponentialBackoff(DEFAULT_RETRY_DELAY),
  retryOn: isRetryableTransportOr5xx,
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'fail',
  defaultRetryAfterMs: 5_000,
});

export interface PubMedHttpOptions {
  /** Retry policy (default PUBMED_POLICY). */
  policy?: RetryPolicy;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}

/** An NCBI E-utilities Axios instance with the shared retry attached. */
export function createPubMedHttp(options: PubMedHttpOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: NCBI_BASE_URL,
    timeout: 30000,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? PUBMED_POLICY, 'pubmed', options.retryDeps);
}

export interface ESearchParams {
  db?: string;
  term: string;
  retmax?: number;
  retstart?: number;
  sort?: string;
  datetype?: string;
  reldate?: number;
  mindate?: string;
  maxdate?: string;
  usehistory?: 'y' | 'n';
}

export interface ESummaryParams {
  db?: string;
  id: string;
  retmode?: string;
}

export interface EFetchParams {
  db?: string;
  id: string;
  rettype?: string;
  retmode?: string;
}

export interface ELinkParams {
  db?: string;
  dbfrom?: string;
  id: string;
  linkname?: string;
  cmd?: string;
}

export class PubMedClient {
  private readonly apiKey?: string;
  private readonly cacheTtl: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly cache: Map<string, CacheEntry>;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly axiosInstance: AxiosInstance;

  constructor(options: PubMedClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.NCBI_API_KEY;
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();
    this.rateLimiter = options.rateLimiter ?? createNcbiRateLimiter(!!this.apiKey);

    this.axiosInstance = createPubMedHttp({
      policy: {
        ...PUBMED_POLICY,
        maxAttempts: this.maxRetries,
        backoffMs: exponentialBackoff(this.retryDelay),
        // A token before every attempt; the wait counts against the budget.
        beforeAttempt: (signal) => this.rateLimiter.waitForToken(signal),
      },
      adapter: options.adapter,
      retryDeps: options.retryDeps,
    });
  }

  /**
   * Execute a request with caching; rate limiting and retries run in the
   * shared retry adapter.
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, unknown>,
    parser: (xml: string) => T
  ): Promise<T> {
    // Add API key if available
    const fullParams: Record<string, unknown> = {
      ...filterNoneValues(params),
      ...(this.apiKey ? { api_key: this.apiKey } : {}),
    };

    // Check cache
    const cacheKey = generateCacheKey(endpoint, fullParams);
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return cachedEntry.data as T;
    }

    const response = await this.axiosInstance.get(endpoint, {
      params: fullParams,
      responseType: 'text',
    });

    const data = parser(response.data);

    // Cache result
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  /**
   * ESearch - Search and retrieve UIDs
   */
  async esearch(params: ESearchParams): Promise<ESearchResult> {
    return this.request(
      'esearch.fcgi',
      {
        db: params.db || 'pubmed',
        term: params.term,
        retmax: params.retmax || 20,
        retstart: params.retstart || 0,
        sort: params.sort,
        datetype: params.datetype,
        reldate: params.reldate,
        mindate: params.mindate,
        maxdate: params.maxdate,
        usehistory: params.usehistory,
        retmode: 'xml',
      },
      parseESearchResult
    );
  }

  /**
   * ESummary - Retrieve document summaries
   */
  async esummary(params: ESummaryParams): Promise<ArticleSummary[]> {
    return this.request(
      'esummary.fcgi',
      {
        db: params.db || 'pubmed',
        id: params.id,
        retmode: 'xml',
      },
      parseESummaryResult
    );
  }

  /**
   * EFetch - Retrieve full records
   */
  async efetch(params: EFetchParams): Promise<PubMedArticle[]> {
    return this.request(
      'efetch.fcgi',
      {
        db: params.db || 'pubmed',
        id: params.id,
        rettype: params.rettype || 'xml',
        retmode: 'xml',
      },
      parseEFetchResult
    );
  }

  /**
   * ELink - Find related records
   */
  async elink(params: ELinkParams): Promise<LinkResult> {
    return this.request(
      'elink.fcgi',
      {
        db: params.db || 'pubmed',
        dbfrom: params.dbfrom || 'pubmed',
        id: params.id,
        linkname: params.linkname,
        cmd: params.cmd || 'neighbor',
        retmode: 'xml',
      },
      parseELinkResult
    );
  }

  /**
   * Search PubMed with a query string
   */
  async search(
    query: string,
    options?: {
      maxResults?: number;
      start?: number;
      sort?: string;
      minDate?: string;
      maxDate?: string;
    }
  ): Promise<{ count: number; pmids: string[]; queryTranslation: string }> {
    const result = await this.esearch({
      term: query,
      retmax: options?.maxResults || 20,
      retstart: options?.start || 0,
      sort: options?.sort,
      mindate: options?.minDate,
      maxdate: options?.maxDate,
    });

    return {
      count: result.count,
      pmids: result.idList,
      queryTranslation: result.queryTranslation,
    };
  }

  /**
   * Fetch article details by PMID(s)
   */
  async fetchArticles(pmids: string | string[]): Promise<PubMedArticle[]> {
    const idString = Array.isArray(pmids) ? pmids.join(',') : pmids;
    return this.efetch({ id: idString });
  }

  /**
   * Get article summaries by PMID(s)
   */
  async getArticleSummaries(
    pmids: string | string[]
  ): Promise<ArticleSummary[]> {
    const idString = Array.isArray(pmids) ? pmids.join(',') : pmids;
    return this.esummary({ id: idString });
  }

  /**
   * Find related articles
   */
  async findRelatedArticles(pmid: string): Promise<string[]> {
    const result = await this.elink({
      id: pmid,
      linkname: 'pubmed_pubmed',
    });

    const relatedLinks = result.linkSetDb?.find(
      (ls) => ls.linkName === 'pubmed_pubmed'
    );
    return relatedLinks?.link.map((l) => l.id) || [];
  }

  /**
   * Get articles that cite the given article
   */
  async getCitingArticles(pmid: string): Promise<string[]> {
    const result = await this.elink({
      id: pmid,
      linkname: 'pubmed_pubmed_citedin',
    });

    const citedInLinks = result.linkSetDb?.find(
      (ls) => ls.linkName === 'pubmed_pubmed_citedin'
    );
    return citedInLinks?.link.map((l) => l.id) || [];
  }

  /**
   * Get references (articles cited by the given article)
   */
  async getReferences(pmid: string): Promise<string[]> {
    const result = await this.elink({
      id: pmid,
      linkname: 'pubmed_pubmed_refs',
    });

    const refsLinks = result.linkSetDb?.find(
      (ls) => ls.linkName === 'pubmed_pubmed_refs'
    );
    return refsLinks?.link.map((l) => l.id) || [];
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

  /**
   * Check if API key is configured
   */
  hasApiKey(): boolean {
    return !!this.apiKey;
  }
}

// Global client instance
let _client: PubMedClient | null = null;

/**
 * Initialize the global client
 */
export function initializeClient(options?: PubMedClientOptions): PubMedClient {
  _client = new PubMedClient(options);
  return _client;
}

/**
 * Get the global client instance
 */
export function getClient(): PubMedClient {
  if (!_client) {
    throw new Error('PubMedClient not initialized. Call initializeClient() first.');
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
