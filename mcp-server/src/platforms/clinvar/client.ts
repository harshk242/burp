import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { decodeFrequencySummary } from './frequency-decoder.js';
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
import type { TokenBucketRateLimiter } from '../../shared/rate-limiter.js';
import { createNcbiHttp } from '../../shared/ncbi-http.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { isRetryableTransportOr5xx } from '../../shared/http-retry-classify.js';
import { asArray, optNumber, optString } from '../../shared/json.js';
import { NCBIAPIError } from './exceptions.js';
import type {
  CacheEntry,
  ClinVarClientOptions,
  VariantInfo,
  VCVRecord,
  ClinicalTablesResult,
  ClinicalTablesVariant,
} from './types.js';

const CLINICAL_TABLES_URL = 'https://clinicaltables.nlm.nih.gov/api/variants/v4';
const DEFAULT_CACHE_TTL = 3600 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 1000;

function exponentialBackoff(baseMs: number): (attempt: number) => number {
  return (attempt) => 2 ** (attempt - 1) * baseMs;
}

export const CLINVAR_NCBI_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  backoffMs: exponentialBackoff(DEFAULT_RETRY_DELAY),
  retryOn: isRetryableTransportOr5xx,
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'fail',
  fallbackReportedRetryAfterMs: 5_000,
});

export const CLINICAL_TABLES_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoffMs: [0],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
});

export interface ClinVarHttpOptions {
  policy?: RetryPolicy;
  adapter?: AxiosAdapter | undefined;
  retryDeps?: RetryDeps | undefined;
}

export interface ClinVarNcbiHttpOptions extends ClinVarHttpOptions {
  /** The API key these requests send; it picks the shared NCBI limiter. */
  apiKey?: string | undefined;
  rateLimiter?: TokenBucketRateLimiter | undefined;
}

export function createClinVarNcbiHttp(options: ClinVarNcbiHttpOptions = {}): AxiosInstance {
  return createNcbiHttp({ ...options, platform: 'clinvar', policy: options.policy ?? CLINVAR_NCBI_POLICY });
}

export function createClinicalTablesHttp(options: ClinVarHttpOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: CLINICAL_TABLES_URL,
    timeout: 30000,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? CLINICAL_TABLES_POLICY, 'clinvar', options.retryDeps);
}

export class ClinVarClient {
  private readonly apiKey?: string | undefined;
  private readonly cacheTtl: number;
  private readonly maxAttempts: number;
  private readonly retryDelay: number;
  /** Raw E-utilities bodies; each request re-parses with its own parser. */
  private readonly ncbiCache: Map<string, CacheEntry<string>>;
  private readonly clinicalTablesCache: Map<string, CacheEntry<ClinicalTablesResult>>;
  private readonly ncbiAxios: AxiosInstance;
  private readonly clinicalTablesAxios: AxiosInstance;

  constructor(options: ClinVarClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.NCBI_API_KEY;
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.ncbiCache = new Map();
    this.clinicalTablesCache = new Map();

    this.ncbiAxios = createClinVarNcbiHttp({
      policy: {
        ...CLINVAR_NCBI_POLICY,
        maxAttempts: this.maxAttempts,
        backoffMs: exponentialBackoff(this.retryDelay),
      },
      apiKey: this.apiKey,
      rateLimiter: options.rateLimiter,
      adapter: options.adapter,
      retryDeps: options.retryDeps,
    });

    this.clinicalTablesAxios = createClinicalTablesHttp({
      adapter: options.adapter,
      retryDeps: options.retryDeps,
    });
  }

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
    const cachedEntry = this.ncbiCache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return parser(cachedEntry.data);
    }

    const response = await this.ncbiAxios.get<unknown>(endpoint, {
      params: fullParams,
      responseType: 'text',
    });
    const body = response.data;
    if (typeof body !== 'string') {
      throw new NCBIAPIError(`Unexpected non-text response from NCBI ${endpoint}`);
    }

    const data = parser(body);

    this.ncbiCache.set(cacheKey, {
      data: body,
      timestamp: Date.now(),
    });

    return data;
  }

  private async clinicalTablesRequest(
    params: Record<string, unknown>
  ): Promise<ClinicalTablesResult> {
    const cacheKey = generateCacheKey('clinicaltables', params);
    const cachedEntry = this.clinicalTablesCache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return cachedEntry.data;
    }

    const response = await this.clinicalTablesAxios.get<unknown>('/search', {
      params: filterNoneValues(params),
    });

    // Clinical Tables returns array: [total, list_of_codes, extra_data, list_of_display_strings]
    const body = asArray(response.data);
    const variants = asArray(body[3]).map((item): ClinicalTablesVariant => {
      const row = asArray(item);
      const position = optString(row[4]);
      return {
        name: optString(row[0]) || '',
        gene: optString(row[1]) || undefined,
        clinicalSignificance: optString(row[2]) || undefined,
        chromosome: optString(row[3]) || undefined,
        position: position ? parseInt(position, 10) : undefined,
      };
    });

    const result: ClinicalTablesResult = {
      totalCount: optNumber(body[0]) || 0,
      variants,
    };

    this.clinicalTablesCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    return result;
  }

  async search(
    term: string,
    options?: { maxResults?: number | undefined; start?: number }
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

  async searchByGene(
    gene: string,
    options?: {
      maxResults?: number | undefined;
      clinicalSignificance?: string | undefined;
    }
  ): Promise<{ count: number; ids: string[] }> {
    const term = buildClinVarSearchTerm({
      gene,
      clinicalSignificance: options?.clinicalSignificance,
    });

    return this.search(term, { maxResults: options?.maxResults });
  }

  async searchByCondition(
    condition: string,
    options?: {
      maxResults?: number | undefined;
      clinicalSignificance?: string | undefined;
    }
  ): Promise<{ count: number; ids: string[] }> {
    const term = buildClinVarSearchTerm({
      condition,
      clinicalSignificance: options?.clinicalSignificance,
    });

    return this.search(term, { maxResults: options?.maxResults });
  }

  async searchByCoordinates(
    chromosome: string,
    start: number,
    stop?: number,
    options?: { maxResults?: number | undefined }
  ): Promise<{ count: number; ids: string[] }> {
    const coordTerm = stop
      ? `${chromosome}[chr] AND ${start}:${stop}[cpos]`
      : `${chromosome}[chr] AND ${start}[cpos]`;

    return this.search(coordTerm, { maxResults: options?.maxResults });
  }

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

  async getVariantFrequency(variationId: string) {
    const id = toVariationId(variationId);
    return this.ncbiRequest(
      'esummary.fcgi',
      { id, retmode: 'json' },
      (json) => decodeFrequencySummary(JSON.parse(json), id)
    );
  }

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

    return records[0] ?? null;
  }

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

  async searchByRsId(rsId: string): Promise<{ count: number; ids: string[] }> {
    const cleanRsId = rsId.replace(/^rs/i, '');
    return this.search(`rs${cleanRsId}`);
  }

  async searchByMolecularConsequence(
    consequence: string,
    options?: {
      gene?: string | undefined;
      maxResults?: number | undefined;
    }
  ): Promise<{ count: number; ids: string[] }> {
    const term = buildClinVarSearchTerm({
      molecularConsequence: consequence,
      gene: options?.gene,
    });

    return this.search(term, { maxResults: options?.maxResults });
  }

  async searchByReviewStatus(
    reviewStatus: string,
    options?: {
      gene?: string | undefined;
      clinicalSignificance?: string | undefined;
      maxResults?: number | undefined;
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
    this.ncbiCache.clear();
    this.clinicalTablesCache.clear();
  }

  getCacheStats(): { size: number; entries: number } {
    const size = this.ncbiCache.size + this.clinicalTablesCache.size;
    return { size, entries: size };
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }
}

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
