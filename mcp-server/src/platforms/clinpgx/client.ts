import { fetchDatabaseStats } from './database-stats.js';
import { parseGeneInfo, parseDrugInfo, parseVariantInfo, parseClinicalAnnotation, parseDosingGuideline, parseDrugLabel, parsePathway } from './response-parsers.js';
import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { NotFoundError } from './exceptions.js';
import { UpstreamError } from '../../shared/exceptions.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { isRetryableTransportOr5xx } from '../../shared/http-retry-classify.js';
import {
  filterNoneValues,
  isPharmGKBAccession,
  generateCacheKey,
} from './utils.js';
import type {
  CacheEntry,
  PharmGKBClientOptions,
  GeneInfo,
  DrugInfo,
  VariantInfo,
  ClinicalAnnotation,
  DosingGuideline,
  DrugLabel,
  Pathway,
  DrugGeneInteraction,
  SearchResult,
} from './types.js';

export const PHARMGKB_BASE_URL = 'https://api.clinpgx.org/v1';
const DEFAULT_CACHE_TTL = 3600 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 1000;

type AnyObject = Record<string, any>;

function exponentialBackoff(baseMs: number): (attempt: number) => number {
  return (attempt) => 2 ** (attempt - 1) * baseMs;
}

export const CLINPGX_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  backoffMs: exponentialBackoff(DEFAULT_RETRY_DELAY),
  retryOn: isRetryableTransportOr5xx,
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'retry',
});

export interface ClinPGxHttpOptions {
  policy?: RetryPolicy;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

export function createClinPGxHttp(options: ClinPGxHttpOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: PHARMGKB_BASE_URL,
    timeout: 30000,
    headers: {
      'Accept': 'application/json',
    },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? CLINPGX_POLICY, 'clinpgx', options.retryDeps);
}

export class PharmGKBClient {
  private readonly cacheTtl: number;
  private readonly maxAttempts: number;
  private readonly retryDelay: number;
  private readonly cache: Map<string, CacheEntry>;
  private readonly axiosInstance: AxiosInstance;

  constructor(options: PharmGKBClientOptions = {}) {
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();

    this.axiosInstance = createClinPGxHttp({
      policy: {
        ...CLINPGX_POLICY,
        maxAttempts: this.maxAttempts,
        backoffMs: exponentialBackoff(this.retryDelay),
      },
      adapter: options.adapter,
      retryDeps: options.retryDeps,
    });
  }

  private async request<T>(
    endpoint: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const cacheKey = generateCacheKey(endpoint, params);
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return cachedEntry.data as T;
    }

    let response;
    try {
      response = await this.axiosInstance.get(endpoint, {
        params: filterNoneValues(params || {}),
      });
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) {
        throw new NotFoundError(`Resource not found: ${endpoint}`);
      }
      throw error;
    }

    const data = response.data;

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data as T;
  }

  async searchGenes(query: string, maxResults: number = 20): Promise<SearchResult<GeneInfo>> {
    try {
      const params: Record<string, unknown> = query && query.trim()
        ? { symbol: query }
        : { cpicGene: true };

      const response = await this.request<AnyObject>('/data/gene', params);

      const data = response.data || [];
      const results: GeneInfo[] = data.slice(0, maxResults).map((gene: AnyObject) => parseGeneInfo(gene));

      return {
        totalCount: response.total || results.length,
        results,
        query: query || 'CPIC pharmacogenes',
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          totalCount: 0,
          results: [],
          query,
        };
      }
      throw error;
    }
  }

  async getGeneInfo(idOrSymbol: string): Promise<GeneInfo | null> {
    try {
      if (isPharmGKBAccession(idOrSymbol)) {
        const response = await this.request<AnyObject>(`/data/gene/${encodeURIComponent(idOrSymbol)}`);
        return parseGeneInfo(response.data);
      }

      const response = await this.request<AnyObject>('/data/gene', {
        symbol: idOrSymbol,
      });

      const data = response.data || [];
      if (data.length === 0) {
        return null;
      }

      return parseGeneInfo(data[0]);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async searchDrugs(query: string, maxResults: number = 20): Promise<SearchResult<DrugInfo>> {
    try {
      if (!query || !query.trim()) {
        return {
          totalCount: 0,
          results: [],
          query: query || '',
        };
      }

      const response = await this.request<AnyObject>('/data/chemical', {
        name: query,
      });

      const data = response.data || [];
      const results: DrugInfo[] = data.slice(0, maxResults).map((drug: AnyObject) => parseDrugInfo(drug));

      return {
        totalCount: response.total || results.length,
        results,
        query,
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          totalCount: 0,
          results: [],
          query,
        };
      }
      throw error;
    }
  }

  async getDrugInfo(idOrName: string): Promise<DrugInfo | null> {
    try {
      if (isPharmGKBAccession(idOrName)) {
        const response = await this.request<AnyObject>(`/data/chemical/${encodeURIComponent(idOrName)}`);
        return parseDrugInfo(response.data);
      }

      const response = await this.request<AnyObject>('/data/chemical', {
        name: idOrName,
      });

      const data = response.data || [];
      if (data.length === 0) {
        return null;
      }

      return parseDrugInfo(data[0]);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async searchVariants(query: string, maxResults: number = 20): Promise<SearchResult<VariantInfo>> {
    try {
      if (!query || !query.trim()) {
        return {
          totalCount: 0,
          results: [],
          query: query || '',
        };
      }

      const response = await this.request<AnyObject>('/data/variant', {
        symbol: query,
      });

      const data = response.data || [];
      const results: VariantInfo[] = data.slice(0, maxResults).map((variant: AnyObject) => parseVariantInfo(variant));

      return {
        totalCount: response.total || results.length,
        results,
        query,
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          totalCount: 0,
          results: [],
          query,
        };
      }
      throw error;
    }
  }

  async getVariantInfo(idOrRsId: string): Promise<VariantInfo | null> {
    try {
      if (isPharmGKBAccession(idOrRsId)) {
        const response = await this.request<AnyObject>(`/data/variant/${encodeURIComponent(idOrRsId)}`);
        return parseVariantInfo(response.data);
      }

      const response = await this.request<AnyObject>('/data/variant', {
        symbol: idOrRsId,
      });

      const data = response.data || [];
      if (data.length === 0) {
        return null;
      }

      return parseVariantInfo(data[0]);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async getClinicalAnnotationsForGene(gene: string): Promise<ClinicalAnnotation[]> {
    try {
      const response = await this.request<AnyObject>('/data/clinicalAnnotation', {
        'location.genes.symbol': gene,
      });

      const data = response.data || [];
      return data.map((annotation: AnyObject) => parseClinicalAnnotation(annotation));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getClinicalAnnotationsForDrug(drug: string): Promise<ClinicalAnnotation[]> {
    try {
      const response = await this.request<AnyObject>('/data/clinicalAnnotation', {
        'relatedChemicals.name': drug,
      });

      const data = response.data || [];
      return data.map((annotation: AnyObject) => parseClinicalAnnotation(annotation));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getDrugGeneAnnotations(drug: string, gene: string): Promise<ClinicalAnnotation[]> {
    try {
      const response = await this.request<AnyObject>('/data/clinicalAnnotation', {
        'relatedChemicals.name': drug,
        'location.genes.symbol': gene,
      });

      const data = response.data || [];
      return data.map((annotation: AnyObject) => parseClinicalAnnotation(annotation));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getDosingGuidelinesForGene(gene: string): Promise<DosingGuideline[]> {
    try {
      const response = await this.request<AnyObject>('/data/guidelineAnnotation', {
        'relatedGenes.symbol': gene,
      });

      const data = response.data || [];
      return data.map((guideline: AnyObject) => parseDosingGuideline(guideline));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getDosingGuidelinesForDrug(drug: string): Promise<DosingGuideline[]> {
    try {
      const response = await this.request<AnyObject>('/data/guidelineAnnotation', {
        'relatedChemicals.name': drug,
      });

      const data = response.data || [];
      return data.map((guideline: AnyObject) => parseDosingGuideline(guideline));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getDrugLabels(drug: string): Promise<DrugLabel[]> {
    try {
      const response = await this.request<AnyObject>('/data/labelAnnotation', {
        'relatedChemicals.name': drug,
      });

      const data = response.data || [];
      return data.map((label: AnyObject) => parseDrugLabel(label));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getPathways(query?: string): Promise<Pathway[]> {
    try {
      const params = query ? { 'genes.symbol': query } : { cpicGene: true };
      const response = await this.request<AnyObject>('/data/pathway', params);

      const data = response.data || [];
      return data.map(parsePathway);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getGenePathways(gene: string): Promise<Pathway[]> {
    try {
      const response = await this.request<AnyObject>('/data/pathway', {
        'genes.symbol': gene,
      });

      const data = response.data || [];
      return data.map(parsePathway);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  async getDrugGeneInteractions(gene: string): Promise<DrugGeneInteraction[]> {
    const annotations = await this.getClinicalAnnotationsForGene(gene);
    const guidelines = await this.getDosingGuidelinesForGene(gene);

    const interactionMap = new Map<string, DrugGeneInteraction>();

    for (const annotation of annotations) {
      const key = `${annotation.drug}:${annotation.gene}`;
      if (!interactionMap.has(key)) {
        interactionMap.set(key, {
          drug: annotation.drug,
          gene: annotation.gene,
          phenotypeCategory: annotation.phenotypeCategory,
          hasClinicalAnnotation: true,
          evidenceLevel: annotation.levelOfEvidence,
        });
      }
    }

    for (const guideline of guidelines) {
      for (const drug of guideline.drugs) {
        const key = `${drug}:${gene}`;
        const existing = interactionMap.get(key);
        if (existing) {
          existing.hasGuideline = true;
        } else {
          interactionMap.set(key, {
            drug,
            gene,
            hasGuideline: true,
          });
        }
      }
    }

    return Array.from(interactionMap.values());
  }

  async getDatabaseStats() {
    return fetchDatabaseStats((endpoint, params) => this.request<AnyObject>(endpoint, params));
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

let _client: PharmGKBClient | null = null;

export function initializeClient(options?: PharmGKBClientOptions): PharmGKBClient {
  _client = new PharmGKBClient(options);
  return _client;
}

export function getClient(): PharmGKBClient {
  if (!_client) {
    throw new Error('PharmGKBClient not initialized. Call initializeClient() first.');
  }
  return _client;
}

export function closeClient(): void {
  if (_client) {
    _client.clearCache();
    _client = null;
  }
}
