// PubMed API Client with rate limiting and caching

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  NetworkError,
  NCBIAPIError,
  RateLimitError,
} from './exceptions.js';
import {
  filterNoneValues,
  generateCacheKey,
  sleep,
  calculateBackoff,
  isRetryableStatus,
} from './utils.js';
import {
  parseESearchResult,
  parseESummaryResult,
  parseEFetchResult,
  parseELinkResult,
} from './xml-parser.js';
import { TokenBucketRateLimiter, createNcbiRateLimiter } from '../../shared/rate-limiter.js';
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
  private axiosInstance: AxiosInstance;

  constructor(options: PubMedClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.NCBI_API_KEY;
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();
    this.rateLimiter = createNcbiRateLimiter(!!this.apiKey);

    this.axiosInstance = axios.create({
      baseURL: NCBI_BASE_URL,
      timeout: 30000,
    });
  }

  /**
   * Execute a request with rate limiting, caching, and retries
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

    // Execute with retries
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Wait for rate limiter
        await this.rateLimiter.waitForToken();

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
      } catch (error) {
        lastError = error as Error;

        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          const status = axiosError.response?.status;

          if (status === 429) {
            const retryAfter = parseInt(
              axiosError.response?.headers['retry-after'] || '5',
              10
            );
            throw new RateLimitError(
              'NCBI rate limit exceeded',
              retryAfter * 1000
            );
          }

          if (status && !isRetryableStatus(status)) {
            throw new NetworkError(
              `HTTP error ${status}: ${axiosError.message}`,
              status
            );
          }

          if (attempt < this.maxRetries - 1) {
            const delay = calculateBackoff(attempt, this.retryDelay);
            console.warn(
              `Request failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delay}ms...`
            );
            await sleep(delay);
          }
        } else {
          throw error;
        }
      }
    }

    throw lastError || new NetworkError('Request failed after all retries');
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
