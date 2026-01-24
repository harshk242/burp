// PharmGKB API Client for ClinPGx MCP Server

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  NetworkError,
  PharmGKBAPIError,
  NotFoundError,
} from './exceptions.js';
import {
  filterNoneValues,
  generateCacheKey,
  sleep,
  calculateBackoff,
  isRetryableStatus,
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

const PHARMGKB_BASE_URL = 'https://api.pharmgkb.org/v1';
const DEFAULT_CACHE_TTL = 3600 * 1000; // 1 hour
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = Record<string, any>;

export class PharmGKBClient {
  private readonly cacheTtl: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly cache: Map<string, CacheEntry>;
  private axiosInstance: AxiosInstance;

  constructor(options: PharmGKBClientOptions = {}) {
    this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.cache = new Map();

    this.axiosInstance = axios.create({
      baseURL: PHARMGKB_BASE_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Execute a request with caching and retries
   */
  private async request<T>(
    endpoint: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const cacheKey = generateCacheKey(endpoint, params);
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
      return cachedEntry.data as T;
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.axiosInstance.get(endpoint, {
          params: filterNoneValues(params || {}),
        });

        const data = response.data;

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

          if (status === 404) {
            throw new NotFoundError(`Resource not found: ${endpoint}`);
          }

          if (status && !isRetryableStatus(status)) {
            throw new NetworkError(`HTTP error ${status}: ${axiosError.message}`, status);
          }

          if (attempt < this.maxRetries - 1) {
            const delay = calculateBackoff(attempt, this.retryDelay);
            await sleep(delay);
          }
        } else {
          throw error;
        }
      }
    }

    throw lastError || new NetworkError('Request failed after all retries');
  }

  // =============== Gene Methods ===============

  /**
   * Search for genes
   */
  async searchGenes(query: string, maxResults: number = 20): Promise<SearchResult<GeneInfo>> {
    const response = await this.request<AnyObject>('/data/gene', {
      q: query,
      limit: maxResults,
    });

    const data = response.data || [];
    const results: GeneInfo[] = data.map((gene: AnyObject) => this.parseGeneInfo(gene));

    return {
      totalCount: response.total || results.length,
      results,
      query,
    };
  }

  /**
   * Get gene info by ID or symbol
   */
  async getGeneInfo(idOrSymbol: string): Promise<GeneInfo | null> {
    try {
      // Try by symbol first
      const response = await this.request<AnyObject>(`/data/gene/${encodeURIComponent(idOrSymbol)}`);
      return this.parseGeneInfo(response.data);
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

  // =============== Drug Methods ===============

  /**
   * Search for drugs
   */
  async searchDrugs(query: string, maxResults: number = 20): Promise<SearchResult<DrugInfo>> {
    const response = await this.request<AnyObject>('/data/chemical', {
      q: query,
      limit: maxResults,
    });

    const data = response.data || [];
    const results: DrugInfo[] = data.map((drug: AnyObject) => this.parseDrugInfo(drug));

    return {
      totalCount: response.total || results.length,
      results,
      query,
    };
  }

  /**
   * Get drug info by ID or name
   */
  async getDrugInfo(idOrName: string): Promise<DrugInfo | null> {
    try {
      const response = await this.request<AnyObject>(`/data/chemical/${encodeURIComponent(idOrName)}`);
      return this.parseDrugInfo(response.data);
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

  // =============== Variant Methods ===============

  /**
   * Search for variants
   */
  async searchVariants(query: string, maxResults: number = 20): Promise<SearchResult<VariantInfo>> {
    const response = await this.request<AnyObject>('/data/variant', {
      q: query,
      limit: maxResults,
    });

    const data = response.data || [];
    const results: VariantInfo[] = data.map((variant: AnyObject) => this.parseVariantInfo(variant));

    return {
      totalCount: response.total || results.length,
      results,
      query,
    };
  }

  /**
   * Get variant info by ID or rsID
   */
  async getVariantInfo(idOrRsId: string): Promise<VariantInfo | null> {
    try {
      const response = await this.request<AnyObject>(`/data/variant/${encodeURIComponent(idOrRsId)}`);
      return this.parseVariantInfo(response.data);
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

  // =============== Clinical Annotation Methods ===============

  /**
   * Get clinical annotations for a gene
   */
  async getClinicalAnnotationsForGene(gene: string): Promise<ClinicalAnnotation[]> {
    const response = await this.request<AnyObject>('/data/clinicalAnnotation', {
      gene: gene,
    });

    const data = response.data || [];
    return data.map((annotation: AnyObject) => this.parseClinicalAnnotation(annotation));
  }

  /**
   * Get clinical annotations for a drug
   */
  async getClinicalAnnotationsForDrug(drug: string): Promise<ClinicalAnnotation[]> {
    const response = await this.request<AnyObject>('/data/clinicalAnnotation', {
      chemical: drug,
    });

    const data = response.data || [];
    return data.map((annotation: AnyObject) => this.parseClinicalAnnotation(annotation));
  }

  /**
   * Get clinical annotations for a drug-gene pair
   */
  async getDrugGeneAnnotations(drug: string, gene: string): Promise<ClinicalAnnotation[]> {
    const response = await this.request<AnyObject>('/data/clinicalAnnotation', {
      chemical: drug,
      gene: gene,
    });

    const data = response.data || [];
    return data.map((annotation: AnyObject) => this.parseClinicalAnnotation(annotation));
  }

  private parseClinicalAnnotation(data: AnyObject): ClinicalAnnotation {
    return {
      id: data.id,
      gene: data.gene?.symbol || data.genes?.[0]?.symbol,
      drug: data.chemical?.name || data.chemicals?.[0]?.name,
      variant: data.variant?.name,
      phenotypeCategory: normalizePhenotypeCategory(data.phenotypeCategory),
      levelOfEvidence: parseEvidenceLevel(data.levelOfEvidence),
      annotation: data.text,
      alleles: data.alleles,
      phenotypes: data.phenotypes?.map((p: AnyObject) => p.name),
      populations: data.populations,
      relatedChemicals: data.chemicals?.map((c: AnyObject) => c.name),
      relatedGenes: data.genes?.map((g: AnyObject) => g.symbol),
      pmids: data.literature?.map((l: AnyObject) => l.pmid),
    };
  }

  // =============== Dosing Guideline Methods ===============

  /**
   * Get dosing guidelines for a gene
   */
  async getDosingGuidelinesForGene(gene: string): Promise<DosingGuideline[]> {
    const response = await this.request<AnyObject>('/data/guideline', {
      gene: gene,
    });

    const data = response.data || [];
    return data.map((guideline: AnyObject) => this.parseDosingGuideline(guideline));
  }

  /**
   * Get dosing guidelines for a drug
   */
  async getDosingGuidelinesForDrug(drug: string): Promise<DosingGuideline[]> {
    const response = await this.request<AnyObject>('/data/guideline', {
      chemical: drug,
    });

    const data = response.data || [];
    return data.map((guideline: AnyObject) => this.parseDosingGuideline(guideline));
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

  // =============== Drug Label Methods ===============

  /**
   * Get drug labels for a drug
   */
  async getDrugLabels(drug: string): Promise<DrugLabel[]> {
    const response = await this.request<AnyObject>('/data/labelAnnotation', {
      chemical: drug,
    });

    const data = response.data || [];
    return data.map((label: AnyObject) => this.parseDrugLabel(label));
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

  // =============== Pathway Methods ===============

  /**
   * Get pathways
   */
  async getPathways(query?: string): Promise<Pathway[]> {
    const params = query ? { q: query } : {};
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
  }

  /**
   * Get pathways for a gene
   */
  async getGenePathways(gene: string): Promise<Pathway[]> {
    const response = await this.request<AnyObject>('/data/pathway', {
      gene: gene,
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
  }

  // =============== Drug-Gene Interaction Methods ===============

  /**
   * Get all drug-gene interactions for a gene
   */
  async getDrugGeneInteractions(gene: string): Promise<DrugGeneInteraction[]> {
    const annotations = await this.getClinicalAnnotationsForGene(gene);
    const guidelines = await this.getDosingGuidelinesForGene(gene);

    // Aggregate interactions
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

  // =============== Database Stats ===============

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<{
    genes: number;
    drugs: number;
    variants: number;
    clinicalAnnotations: number;
    guidelines: number;
    labels: number;
    pathways: number;
  }> {
    // PharmGKB doesn't have a direct stats endpoint, so we query each type
    const [genes, drugs, variants, annotations, guidelines, labels, pathways] = await Promise.all([
      this.request<AnyObject>('/data/gene', { limit: 1 }),
      this.request<AnyObject>('/data/chemical', { limit: 1 }),
      this.request<AnyObject>('/data/variant', { limit: 1 }),
      this.request<AnyObject>('/data/clinicalAnnotation', { limit: 1 }),
      this.request<AnyObject>('/data/guideline', { limit: 1 }),
      this.request<AnyObject>('/data/labelAnnotation', { limit: 1 }),
      this.request<AnyObject>('/data/pathway', { limit: 1 }),
    ]);

    return {
      genes: genes.total || 0,
      drugs: drugs.total || 0,
      variants: variants.total || 0,
      clinicalAnnotations: annotations.total || 0,
      guidelines: guidelines.total || 0,
      labels: labels.total || 0,
      pathways: pathways.total || 0,
    };
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

// Global client instance
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
