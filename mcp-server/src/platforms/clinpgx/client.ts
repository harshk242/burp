import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { NotFoundError } from './exceptions.js';
import { UpstreamError } from '../../shared/exceptions.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { isRetryableTransportOr5xx } from '../../shared/http-retry-classify.js';
import {
  filterNoneValues,
  generateCacheKey,
  parseGuidelineSource,
  parseEvidenceLevel,
  normalizePhenotypeCategory,
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
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

type AnyObject = Record<string, any>;

function exponentialBackoff(baseMs: number): (attempt: number) => number {
  return (attempt) => 2 ** (attempt - 1) * baseMs;
}

/**
 * Production retry policy (plans/shared-http-retry-plan.md, "Platform
 * inventory"): 3 attempts, `2^n × retryDelay` backoff, retry on network/5xx
 * and transport timeouts, 429 retried with the same backoff (Retry-After
 * ignored), any other 4xx (404 and HTTP 408 included) fails at once, 40s
 * request budget.
 */
export const CLINPGX_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_RETRIES,
  backoffMs: exponentialBackoff(DEFAULT_RETRY_DELAY),
  retryOn: isRetryableTransportOr5xx,
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'retry',
});

export interface ClinPGxHttpOptions {
  /** Retry policy (default CLINPGX_POLICY). */
  policy?: RetryPolicy;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
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
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly cache: Map<string, CacheEntry>;
  private readonly axiosInstance: AxiosInstance;

  constructor(options: PharmGKBClientOptions = {}) {
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();

    this.axiosInstance = createClinPGxHttp({
      policy: {
        ...CLINPGX_POLICY,
        maxAttempts: this.maxRetries,
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

  /**
   * Search for genes by symbol
   * PharmGKB API uses 'symbol' parameter for gene search
   * If no query is provided, returns CPIC pharmacogenes
   */
  async searchGenes(query: string, maxResults: number = 20): Promise<SearchResult<GeneInfo>> {
    try {
      const params: Record<string, unknown> = query && query.trim()
        ? { symbol: query }
        : { cpicGene: true };

      const response = await this.request<AnyObject>('/data/gene', params);

      const data = response.data || [];
      const results: GeneInfo[] = data.slice(0, maxResults).map((gene: AnyObject) => this.parseGeneInfo(gene));

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

  /**
   * Get gene info by ID (PAxxxx) or symbol
   * For symbol lookups, use search and return first result
   */
  async getGeneInfo(idOrSymbol: string): Promise<GeneInfo | null> {
    try {
      if (idOrSymbol.startsWith('PA')) {
        const response = await this.request<AnyObject>(`/data/gene/${encodeURIComponent(idOrSymbol)}`);
        return this.parseGeneInfo(response.data);
      }

      const response = await this.request<AnyObject>('/data/gene', {
        symbol: idOrSymbol,
      });

      const data = response.data || [];
      if (data.length === 0) {
        return null;
      }

      return this.parseGeneInfo(data[0]);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private parseGeneInfo(data: AnyObject): GeneInfo {
    return {
      id: data.id || data.pharmgkbAccessionId,
      symbol: data.symbol,
      name: data.name,
      alternateSymbols: data.alternateSymbols,
      chromosomeLocation: data.chromosomeLocation,
      pharmgkbAccessionId: data.pharmgkbAccessionId,
      hasVariants: data.hasVariantAnnotation,
      hasGuidelines: data.hasGuideline,
      hasClinicalAnnotations: data.hasClinicalAnnotation,
      crossReferences: data.crossReferences?.map((xref: AnyObject) => ({
        database: xref.resource,
        id: xref.resourceId,
        url: xref.url,
      })),
      summary: data.summary,
    };
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
      const results: DrugInfo[] = data.slice(0, maxResults).map((drug: AnyObject) => this.parseDrugInfo(drug));

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

  /**
   * Get drug info by ID (PAxxxx) or name
   */
  async getDrugInfo(idOrName: string): Promise<DrugInfo | null> {
    try {
      if (idOrName.startsWith('PA')) {
        const response = await this.request<AnyObject>(`/data/chemical/${encodeURIComponent(idOrName)}`);
        return this.parseDrugInfo(response.data);
      }

      const response = await this.request<AnyObject>('/data/chemical', {
        name: idOrName,
      });

      const data = response.data || [];
      if (data.length === 0) {
        return null;
      }

      return this.parseDrugInfo(data[0]);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private parseDrugInfo(data: AnyObject): DrugInfo {
    return {
      id: data.id || data.pharmgkbAccessionId,
      name: data.name,
      genericNames: data.genericNames,
      brandNames: data.brandNames,
      drugClass: data.drugClasses?.[0]?.name,
      atcCodes: data.atcCodes,
      pharmgkbAccessionId: data.pharmgkbAccessionId,
      hasGuidelines: data.hasGuideline,
      hasClinicalAnnotations: data.hasClinicalAnnotation,
      hasLabels: data.hasLabel,
      crossReferences: data.crossReferences?.map((xref: AnyObject) => ({
        database: xref.resource,
        id: xref.resourceId,
        url: xref.url,
      })),
      summary: data.summary,
    };
  }

  /**
   * Search for variants by rsID or symbol
   * PharmGKB API uses 'symbol' parameter for variant search
   */
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
      const results: VariantInfo[] = data.slice(0, maxResults).map((variant: AnyObject) => this.parseVariantInfo(variant));

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

  /**
   * Get variant info by ID (PAxxxx) or rsID
   */
  async getVariantInfo(idOrRsId: string): Promise<VariantInfo | null> {
    try {
      if (idOrRsId.startsWith('PA')) {
        const response = await this.request<AnyObject>(`/data/variant/${encodeURIComponent(idOrRsId)}`);
        return this.parseVariantInfo(response.data);
      }

      const response = await this.request<AnyObject>('/data/variant', {
        symbol: idOrRsId,
      });

      const data = response.data || [];
      if (data.length === 0) {
        return null;
      }

      return this.parseVariantInfo(data[0]);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private parseVariantInfo(data: AnyObject): VariantInfo {
    return {
      id: data.id || data.pharmgkbAccessionId,
      name: data.name,
      rsid: data.rsid,
      gene: data.gene?.symbol,
      variantType: data.variantType,
      location: data.location,
      hasClinicalAnnotations: data.hasClinicalAnnotation,
      hasGuidelines: data.hasGuideline,
      crossReferences: data.crossReferences?.map((xref: AnyObject) => ({
        database: xref.resource,
        id: xref.resourceId,
        url: xref.url,
      })),
    };
  }

  async getClinicalAnnotationsForGene(gene: string): Promise<ClinicalAnnotation[]> {
    try {
      const response = await this.request<AnyObject>('/data/clinicalAnnotation', {
        'location.genes.symbol': gene,
      });

      const data = response.data || [];
      return data.map((annotation: AnyObject) => this.parseClinicalAnnotation(annotation));
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
      return data.map((annotation: AnyObject) => this.parseClinicalAnnotation(annotation));
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
      return data.map((annotation: AnyObject) => this.parseClinicalAnnotation(annotation));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  private parseClinicalAnnotation(data: AnyObject): ClinicalAnnotation {
    const levelOfEvidence = data.levelOfEvidence;
    const evidenceLevel = typeof levelOfEvidence === 'object' && levelOfEvidence !== null
      ? levelOfEvidence.term
      : levelOfEvidence;

    const genes = data.location?.genes || data.genes || [];
    const geneSymbol = genes[0]?.symbol;

    const chemicals = data.relatedChemicals || data.chemicals || [];
    const drugName = chemicals[0]?.name;

    const types = data.types || [];
    const phenotypeCategory = types[0] || 'Unknown';

    return {
      id: data.id,
      gene: geneSymbol,
      drug: drugName,
      variant: data.variant?.name || data.location?.displayName,
      phenotypeCategory: normalizePhenotypeCategory(phenotypeCategory),
      levelOfEvidence: parseEvidenceLevel(evidenceLevel),
      annotation: data.text || data.allelePhenotypes?.[0]?.phenotype,
      alleles: data.allelePhenotypes?.map((ap: AnyObject) => ap.allele),
      phenotypes: data.phenotypes?.map((p: AnyObject) => typeof p === 'string' ? p : p.name),
      populations: data.populations,
      relatedChemicals: chemicals.map((c: AnyObject) => c.name),
      relatedGenes: genes.map((g: AnyObject) => g.symbol),
      pmids: data.literature?.map((l: AnyObject) => l.pmid),
    };
  }

  async getDosingGuidelinesForGene(gene: string): Promise<DosingGuideline[]> {
    try {
      const response = await this.request<AnyObject>('/data/guidelineAnnotation', {
        'relatedGenes.symbol': gene,
      });

      const data = response.data || [];
      return data.map((guideline: AnyObject) => this.parseDosingGuideline(guideline));
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
      return data.map((guideline: AnyObject) => this.parseDosingGuideline(guideline));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  private parseDosingGuideline(data: AnyObject): DosingGuideline {
    return {
      id: data.id,
      name: data.name,
      source: parseGuidelineSource(data.name || data.source),
      genes: data.genes?.map((g: AnyObject) => g.symbol) || [],
      drugs: data.chemicals?.map((c: AnyObject) => c.name) || [],
      recommendation: data.recommendation,
      implications: data.implications,
      phenotypeCategory: data.phenotypeCategory,
      alternateDrug: data.alternateDrug,
      url: data.url || `https://www.pharmgkb.org/guideline/${data.id}`,
      version: data.version,
      lastModified: data.lastModified,
    };
  }

  async getDrugLabels(drug: string): Promise<DrugLabel[]> {
    try {
      const response = await this.request<AnyObject>('/data/labelAnnotation', {
        'relatedChemicals.name': drug,
      });

      const data = response.data || [];
      return data.map((label: AnyObject) => this.parseDrugLabel(label));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    }
  }

  private parseDrugLabel(data: AnyObject): DrugLabel {
    return {
      id: data.id,
      name: data.name,
      drug: data.chemical?.name,
      source: data.source,
      agency: data.agency,
      approvalDate: data.approvalDate,
      biomarkerCategory: data.biomarkerCategory,
      genes: data.genes?.map((g: AnyObject) => g.symbol),
      variants: data.variants?.map((v: AnyObject) => v.name),
      labelText: data.text,
      url: data.url,
    };
  }

  async getPathways(query?: string): Promise<Pathway[]> {
    try {
      const params = query ? { 'genes.symbol': query } : { cpicGene: true };
      const response = await this.request<AnyObject>('/data/pathway', params);

      const data = response.data || [];
      return data.map((pathway: AnyObject) => ({
        id: pathway.id,
        name: pathway.name,
        type: pathway.type,
        description: pathway.description,
        genes: pathway.genes?.map((g: AnyObject) => g.symbol),
        drugs: pathway.chemicals?.map((c: AnyObject) => c.name),
        url: pathway.url || `https://www.pharmgkb.org/pathway/${pathway.id}`,
      }));
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
      return data.map((pathway: AnyObject) => ({
        id: pathway.id,
        name: pathway.name,
        type: pathway.type,
        description: pathway.description,
        genes: pathway.genes?.map((g: AnyObject) => g.symbol),
        drugs: pathway.chemicals?.map((c: AnyObject) => c.name),
        url: pathway.url || `https://www.pharmgkb.org/pathway/${pathway.id}`,
      }));
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

  async getDatabaseStats(): Promise<{
    genes: number;
    drugs: number;
    variants: number;
    clinicalAnnotations: number;
    guidelines: number;
    labels: number;
    pathways: number;
    note: string;
  }> {
    const stats = {
      genes: 0,
      drugs: 0,
      variants: 0,
      clinicalAnnotations: 0,
      guidelines: 0,
      labels: 0,
      pathways: 0,
      note: 'Counts represent CPIC pharmacogenes and CYP2D6-related data as representative samples',
    };

    try {
      const [genesResult, pathwaysResult] = await Promise.all([
        this.request<AnyObject>('/data/gene', { cpicGene: true }).catch(() => ({ data: [] })),
        this.request<AnyObject>('/data/pathway', { cpicGene: true }).catch(() => ({ data: [] })),
      ]);
      stats.genes = genesResult.data?.length || 0;
      stats.pathways = pathwaysResult.data?.length || 0;
    } catch {
    }

    try {
      const [annotationsResult, guidelinesResult, labelsResult] = await Promise.all([
        this.request<AnyObject>('/data/clinicalAnnotation', { 'location.genes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
        this.request<AnyObject>('/data/guidelineAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
        this.request<AnyObject>('/data/labelAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
      ]);
      stats.clinicalAnnotations = annotationsResult.data?.length || 0;
      stats.guidelines = guidelinesResult.data?.length || 0;
      stats.labels = labelsResult.data?.length || 0;
    } catch {
    }

    return stats;
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
