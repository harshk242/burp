import { decodeEnvelope, list } from './response-decoding.js';
import { fetchDatabaseStats } from './database-stats.js';
import { parseGeneInfo, parseDrugInfo, parseVariantInfo, parseClinicalAnnotation, parseDosingGuideline, parseDrugLabel, parsePathway } from './response-parsers.js';
import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
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

  private async request(
    endpoint: string,
    params?: Record<string, unknown>
  ): Promise<ReturnType<typeof decodeEnvelope>> {
    const cacheKey = generateCacheKey(endpoint, params);
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return decodeEnvelope(cachedEntry.data);
    }

    const response = await this.axiosInstance.get(endpoint, {
      params: filterNoneValues(params || {}),
    });

    const data = decodeEnvelope(response.data as unknown);

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  async searchGenes(query: string, maxResults: number = 20): Promise<SearchResult<GeneInfo>> {
    query = query.trim();
    if (!query) throw new Error('Gene symbol query must not be blank; use listCPICGenes');
    const params: Record<string, unknown> = { symbol: query };

    const response = await this.request('/data/gene', params);

    const data = list(response.data);
    const results: GeneInfo[] = data.slice(0, maxResults).map((gene) => parseGeneInfo(gene));

    return {
      totalCount: response.total ?? data.length,
      results,
      query,
    };
  }

  async listCPICGenes(maxResults: number = 100): Promise<SearchResult<GeneInfo>> {
    const response = await this.request('/data/gene', { cpicGene: true });
    const records = list(response.data);
    return { totalCount: response.total ?? records.length, results: records.slice(0, maxResults).map(parseGeneInfo), query: 'CPIC pharmacogenes' };
  }

  async getGeneInfo(idOrSymbol: string): Promise<GeneInfo | null> {
    if (isPharmGKBAccession(idOrSymbol)) {
      const response = await this.request(`/data/gene/${encodeURIComponent(idOrSymbol)}`);
      return parseGeneInfo(response.data);
    }

    const response = await this.request('/data/gene', {
      symbol: idOrSymbol,
    });

    const data = list(response.data);
    if (data.length === 0) {
      return null;
    }

    return parseGeneInfo(data[0]);
  }

  async searchDrugs(query: string, maxResults: number = 20): Promise<SearchResult<DrugInfo>> {
    if (!query || !query.trim()) {
      return {
        totalCount: 0,
        results: [],
        query: query || '',
      };
    }

    const response = await this.request('/data/chemical', {
      name: query,
    });

    const data = list(response.data);
    const results: DrugInfo[] = data.slice(0, maxResults).map((drug) => parseDrugInfo(drug));

    return {
      totalCount: response.total ?? data.length,
      results,
      query,
    };
  }

  async getDrugInfo(idOrName: string): Promise<DrugInfo | null> {
    if (isPharmGKBAccession(idOrName)) {
      const response = await this.request(`/data/chemical/${encodeURIComponent(idOrName)}`);
      return parseDrugInfo(response.data);
    }

    const response = await this.request('/data/chemical', {
      name: idOrName,
    });

    const data = list(response.data);
    if (data.length === 0) {
      return null;
    }

    return parseDrugInfo(data[0]);
  }

  async searchVariants(query: string, maxResults: number = 20): Promise<SearchResult<VariantInfo>> {
    if (!query || !query.trim()) {
      return {
        totalCount: 0,
        results: [],
        query: query || '',
      };
    }

    const response = await this.request('/data/variant', {
      symbol: query,
    });

    const data = list(response.data);
    const results: VariantInfo[] = data.slice(0, maxResults).map((variant) => parseVariantInfo(variant));

    return {
      totalCount: response.total ?? data.length,
      results,
      query,
    };
  }

  async getVariantInfo(idOrRsId: string): Promise<VariantInfo | null> {
    if (isPharmGKBAccession(idOrRsId)) {
      const response = await this.request(`/data/variant/${encodeURIComponent(idOrRsId)}`);
      return parseVariantInfo(response.data);
    }

    const response = await this.request('/data/variant', {
      symbol: idOrRsId,
    });

    const data = list(response.data);
    if (data.length === 0) {
      return null;
    }

    return parseVariantInfo(data[0]);
  }

  async getClinicalAnnotationsForGene(gene: string): Promise<ClinicalAnnotation[]> {
    const response = await this.request('/data/clinicalAnnotation', {
      'location.genes.symbol': gene,
    });

    const data = list(response.data);
    return data.map((annotation) => parseClinicalAnnotation(annotation));
  }

  async getClinicalAnnotationsForDrug(drug: string): Promise<ClinicalAnnotation[]> {
    const response = await this.request('/data/clinicalAnnotation', {
      'relatedChemicals.name': drug,
    });

    const data = list(response.data);
    return data.map((annotation) => parseClinicalAnnotation(annotation));
  }

  async getDrugGeneAnnotations(drug: string, gene: string): Promise<ClinicalAnnotation[]> {
    const response = await this.request('/data/clinicalAnnotation', {
      'relatedChemicals.name': drug,
      'location.genes.symbol': gene,
    });

    const data = list(response.data);
    return data.map((annotation) => parseClinicalAnnotation(annotation));
  }

  async getDosingGuidelinesForGene(gene: string): Promise<DosingGuideline[]> {
    const response = await this.request('/data/guidelineAnnotation', {
      'relatedGenes.symbol': gene,
    });

    const data = list(response.data);
    return data.map((guideline) => parseDosingGuideline(guideline));
  }

  async getDosingGuidelinesForDrug(drug: string): Promise<DosingGuideline[]> {
    const response = await this.request('/data/guidelineAnnotation', {
      'relatedChemicals.name': drug,
    });

    const data = list(response.data);
    return data.map((guideline) => parseDosingGuideline(guideline));
  }

  async getDrugLabels(drug: string): Promise<DrugLabel[]> {
    const response = await this.request('/data/labelAnnotation', {
      'relatedChemicals.name': drug,
    });

    const data = list(response.data);
    return data.map((label) => parseDrugLabel(label));
  }

  async getPathways(query?: string): Promise<Pathway[]> {
    const params = { 'genes.symbol': query ?? 'CYP2D6' };
    const response = await this.request('/data/pathway', params);

    const data = list(response.data);
    return data.map(parsePathway);
  }

  async getGenePathways(gene: string): Promise<Pathway[]> {
    const response = await this.request('/data/pathway', {
      'genes.symbol': gene,
    });

    const data = list(response.data);
    return data.map(parsePathway);
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

  async getStarAlleles(gene: string): Promise<VariantInfo[]> {
    const response = await this.request('/data/haplotype', { 'gene.symbol': gene });
    return list(response.data).map(parseVariantInfo).filter(allele => allele.name?.includes('*'));
  }

  async getDatabaseStats() {
    return fetchDatabaseStats((endpoint, params) => this.request(endpoint, params));
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
