// ClinVar API Client with dual API support (E-utilities + Clinical Tables)

import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import {
  filterNoneValues,
  generateCacheKey,
  buildClinVarSearchTerm,
  toVariationId,
} from './utils.js';
import {
  parseESearchResult,
  parseESummaryResult,
  parseVCVRecord,
} from './xml-parser.js';
import { TokenBucketRateLimiter, createNcbiRateLimiter } from '../../shared/rate-limiter.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import type {
  CacheEntry,
  ClinVarClientOptions,
  VariantInfo,
  VCVRecord,
  ClinicalTablesResult,
  ClinicalTablesVariant,
} from './types.js';

const NCBI_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const CLINICAL_TABLES_URL = 'https://clinicaltables.nlm.nih.gov/api/variants/v4';
const DEFAULT_CACHE_TTL = 3600 * 1000; // 1 hour
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

// ── Retry policies ──────────────────────────────────────────────────────────

/** Waits of `2^n × baseMs` before retry n+1 (1s, 2s with the default base). */
function exponentialBackoff(baseMs: number): (attempt: number) => number {
  return (attempt) => 2 ** (attempt - 1) * baseMs;
}

/**
 * NCBI E-utilities policy (plans/shared-http-retry-plan.md, "Platform
 * inventory"): 3 attempts, `2^n × retryDelay` backoff, retry on network/5xx,
 * 429 fails fast with Retry-After (default 5s), 40s request budget. The
 * client adds the NCBI token bucket as `beforeAttempt`.
 */
export const CLINVAR_NCBI_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_RETRIES,
  backoffMs: exponentialBackoff(DEFAULT_RETRY_DELAY),
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'fail',
  defaultRetryAfterMs: 5_000,
});

/** Clinical Tables policy: one attempt, no rate limiter, 40s request budget. */
export const CLINICAL_TABLES_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoffMs: [0],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
});

export interface ClinVarHttpOptions {
  /** Retry policy (default CLINVAR_NCBI_POLICY). */
  policy?: RetryPolicy;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}

function createHttp(baseURL: string, defaultPolicy: RetryPolicy, options: ClinVarHttpOptions): AxiosInstance {
  const instance = axios.create({
    baseURL,
    timeout: 30000,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? defaultPolicy, 'clinvar', options.retryDeps);
}

/** An NCBI E-utilities Axios instance with the shared retry attached. */
export function createClinVarNcbiHttp(options: ClinVarHttpOptions = {}): AxiosInstance {
  return createHttp(NCBI_BASE_URL, CLINVAR_NCBI_POLICY, options);
}

/** A Clinical Tables Axios instance with the shared retry attached (one attempt). */
export function createClinicalTablesHttp(options: ClinVarHttpOptions = {}): AxiosInstance {
  return createHttp(CLINICAL_TABLES_URL, CLINICAL_TABLES_POLICY, options);
}

export class ClinVarClient {
  private readonly apiKey?: string;
  private readonly cacheTtl: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly cache: Map<string, CacheEntry>;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly ncbiAxios: AxiosInstance;
  private readonly clinicalTablesAxios: AxiosInstance;

  constructor(options: ClinVarClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.NCBI_API_KEY;
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();
    this.rateLimiter = options.rateLimiter ?? createNcbiRateLimiter(!!this.apiKey);

    this.ncbiAxios = createClinVarNcbiHttp({
      policy: {
        ...CLINVAR_NCBI_POLICY,
        maxAttempts: this.maxRetries,
        backoffMs: exponentialBackoff(this.retryDelay),
        // A token before every attempt; the wait counts against the budget.
        beforeAttempt: (signal) => this.rateLimiter.waitForToken(signal),
      },
      adapter: options.adapter,
      retryDeps: options.retryDeps,
    });

    this.clinicalTablesAxios = createClinicalTablesHttp({
      adapter: options.adapter,
      retryDeps: options.retryDeps,
    });
  }

  /**
   * Execute NCBI E-utilities request with caching; rate limiting and retries
   * run in the shared retry adapter.
   */
  private async ncbiRequest<T>(
    endpoint: string,
    params: Record<string, unknown>,
    parser: (xml: string) => T
  ): Promise<T> {
    const fullParams: Record<string, unknown> = {
      ...filterNoneValues(params),
      db: 'clinvar',
      ...(this.apiKey ? { api_key: this.apiKey } : {}),
    };

    const cacheKey = generateCacheKey(`ncbi:${endpoint}`, fullParams);
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return cachedEntry.data as T;
    }

    const response = await this.ncbiAxios.get(endpoint, {
      params: fullParams,
      responseType: 'text',
    });

    const data = parser(response.data);

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  /**
   * Execute Clinical Tables API request
   */
  private async clinicalTablesRequest(
    params: Record<string, unknown>
  ): Promise<ClinicalTablesResult> {
    const cacheKey = generateCacheKey('clinicaltables', params);
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return cachedEntry.data as ClinicalTablesResult;
    }

    const response = await this.clinicalTablesAxios.get('/search', {
      params: filterNoneValues(params),
    });

    // Clinical Tables returns array: [total, list_of_codes, extra_data, list_of_display_strings]
    const [totalCount, , , displayData] = response.data;

    const variants: ClinicalTablesVariant[] = (displayData || []).map((item: string[]) => ({
      name: item[0] || '',
      gene: item[1] || undefined,
      clinicalSignificance: item[2] || undefined,
      chromosome: item[3] || undefined,
      position: item[4] ? parseInt(item[4], 10) : undefined,
    }));

    const result: ClinicalTablesResult = {
      totalCount: totalCount || 0,
      variants,
    };

    this.cache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Search ClinVar using E-utilities
   */
  async search(
    term: string,
    options?: { maxResults?: number; start?: number }
  ): Promise<{ count: number; ids: string[] }> {
    const result = await this.ncbiRequest(
      'esearch.fcgi',
      {
        term,
        retmax: options?.maxResults || 20,
        retstart: options?.start || 0,
        retmode: 'xml',
      },
      parseESearchResult
    );

    return {
      count: result.count,
      ids: result.idList,
    };
  }

  /**
   * Search variants by gene name
   */
  async searchByGene(
    gene: string,
    options?: {
      maxResults?: number;
      clinicalSignificance?: string;
    }
  ): Promise<{ count: number; ids: string[] }> {
    const term = buildClinVarSearchTerm({
      gene,
      clinicalSignificance: options?.clinicalSignificance,
    });

    return this.search(term, { maxResults: options?.maxResults });
  }

  /**
   * Search variants by condition/disease
   */
  async searchByCondition(
    condition: string,
    options?: {
      maxResults?: number;
      clinicalSignificance?: string;
    }
  ): Promise<{ count: number; ids: string[] }> {
    const term = buildClinVarSearchTerm({
      condition,
      clinicalSignificance: options?.clinicalSignificance,
    });

    return this.search(term, { maxResults: options?.maxResults });
  }

  /**
   * Search variants by genomic coordinates
   */
  async searchByCoordinates(
    chromosome: string,
    start: number,
    stop?: number,
    options?: { maxResults?: number }
  ): Promise<{ count: number; ids: string[] }> {
    const coordTerm = stop
      ? `${chromosome}[chr] AND ${start}:${stop}[chrpos37]`
      : `${chromosome}[chr] AND ${start}[chrpos37]`;

    return this.search(coordTerm, { maxResults: options?.maxResults });
  }

  /**
   * Get variant summaries by IDs
   */
  async getVariantSummaries(ids: string[]): Promise<VariantInfo[]> {
    if (ids.length === 0) return [];

    return this.ncbiRequest(
      'esummary.fcgi',
      {
        id: ids.join(','),
        retmode: 'xml',
      },
      parseESummaryResult
    );
  }

  /**
   * Get full VCV record
   */
  async getVCVRecord(variationId: string): Promise<VCVRecord | null> {
    const records = await this.ncbiRequest(
      'efetch.fcgi',
      {
        id: toVariationId(variationId),
        rettype: 'vcv',
        // Without it efetch returns an empty set for a numeric variation ID.
        is_variationid: 'true',
        retmode: 'xml',
      },
      parseVCVRecord
    );

    return records.length > 0 ? records[0] : null;
  }

  /**
   * Get multiple VCV records
   */
  async getVCVRecords(variationIds: string[]): Promise<VCVRecord[]> {
    if (variationIds.length === 0) return [];

    return this.ncbiRequest(
      '/efetch.fcgi',
      {
        id: variationIds.map(toVariationId).join(','),
        rettype: 'vcv',
        is_variationid: 'true',
        retmode: 'xml',
      },
      parseVCVRecord
    );
  }

  /**
   * Quick variant lookup using Clinical Tables API
   */
  async quickLookup(
    query: string,
    maxResults: number = 10
  ): Promise<ClinicalTablesResult> {
    return this.clinicalTablesRequest({
      terms: query,
      maxList: maxResults,
      df: 'Name,GeneSymbol,ClinicalSignificance,Chromosome,Start',
    });
  }

  /**
   * Search by rsID
   */
  async searchByRsId(rsId: string): Promise<{ count: number; ids: string[] }> {
    const cleanRsId = rsId.replace(/^rs/i, '');
    // Search by rsID directly - ClinVar recognizes rs numbers without field qualifier
    return this.search(`rs${cleanRsId}`);
  }

  /**
   * Search by molecular consequence
   */
  async searchByMolecularConsequence(
    consequence: string,
    options?: {
      gene?: string;
      maxResults?: number;
    }
  ): Promise<{ count: number; ids: string[] }> {
    const term = buildClinVarSearchTerm({
      molecularConsequence: consequence,
      gene: options?.gene,
    });

    return this.search(term, { maxResults: options?.maxResults });
  }

  /**
   * Search by review status
   */
  async searchByReviewStatus(
    reviewStatus: string,
    options?: {
      gene?: string;
      clinicalSignificance?: string;
      maxResults?: number;
    }
  ): Promise<{ count: number; ids: string[] }> {
    const term = buildClinVarSearchTerm({
      reviewStatus,
      gene: options?.gene,
      clinicalSignificance: options?.clinicalSignificance,
    });

    return this.search(term, { maxResults: options?.maxResults });
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

  hasApiKey(): boolean {
    return !!this.apiKey;
  }
}

// Global client instance
let _client: ClinVarClient | null = null;

export function initializeClient(options?: ClinVarClientOptions): ClinVarClient {
  _client = new ClinVarClient(options);
  return _client;
}

export function getClient(): ClinVarClient {
  if (!_client) {
    throw new Error('ClinVarClient not initialized. Call initializeClient() first.');
  }
  return _client;
}

export function closeClient(): void {
  if (_client) {
    _client.clearCache();
    _client = null;
  }
}
