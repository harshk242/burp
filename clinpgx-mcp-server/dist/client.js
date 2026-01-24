// PharmGKB API Client for ClinPGx MCP Server
import axios from 'axios';
import { NetworkError, NotFoundError, } from './exceptions.js';
import { filterNoneValues, generateCacheKey, sleep, calculateBackoff, isRetryableStatus, parseGuidelineSource, parseEvidenceLevel, normalizePhenotypeCategory, } from './utils.js';
const PHARMGKB_BASE_URL = 'https://api.pharmgkb.org/v1';
const DEFAULT_CACHE_TTL = 3600 * 1000; // 1 hour
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
export class PharmGKBClient {
    cacheTtl;
    maxRetries;
    retryDelay;
    cache;
    axiosInstance;
    constructor(options = {}) {
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
    async request(endpoint, params) {
        const cacheKey = generateCacheKey(endpoint, params);
        const cachedEntry = this.cache.get(cacheKey);
        if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
            return cachedEntry.data;
        }
        let lastError;
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
                return data;
            }
            catch (error) {
                lastError = error;
                if (axios.isAxiosError(error)) {
                    const axiosError = error;
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
                }
                else {
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
    async searchGenes(query, maxResults = 20) {
        const response = await this.request('/data/gene', {
            q: query,
            limit: maxResults,
        });
        const data = response.data || [];
        const results = data.map((gene) => this.parseGeneInfo(gene));
        return {
            totalCount: response.total || results.length,
            results,
            query,
        };
    }
    /**
     * Get gene info by ID or symbol
     */
    async getGeneInfo(idOrSymbol) {
        try {
            // Try by symbol first
            const response = await this.request(`/data/gene/${encodeURIComponent(idOrSymbol)}`);
            return this.parseGeneInfo(response.data);
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                return null;
            }
            throw error;
        }
    }
    parseGeneInfo(data) {
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
            crossReferences: data.crossReferences?.map((xref) => ({
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
    async searchDrugs(query, maxResults = 20) {
        const response = await this.request('/data/chemical', {
            q: query,
            limit: maxResults,
        });
        const data = response.data || [];
        const results = data.map((drug) => this.parseDrugInfo(drug));
        return {
            totalCount: response.total || results.length,
            results,
            query,
        };
    }
    /**
     * Get drug info by ID or name
     */
    async getDrugInfo(idOrName) {
        try {
            const response = await this.request(`/data/chemical/${encodeURIComponent(idOrName)}`);
            return this.parseDrugInfo(response.data);
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                return null;
            }
            throw error;
        }
    }
    parseDrugInfo(data) {
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
            crossReferences: data.crossReferences?.map((xref) => ({
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
    async searchVariants(query, maxResults = 20) {
        const response = await this.request('/data/variant', {
            q: query,
            limit: maxResults,
        });
        const data = response.data || [];
        const results = data.map((variant) => this.parseVariantInfo(variant));
        return {
            totalCount: response.total || results.length,
            results,
            query,
        };
    }
    /**
     * Get variant info by ID or rsID
     */
    async getVariantInfo(idOrRsId) {
        try {
            const response = await this.request(`/data/variant/${encodeURIComponent(idOrRsId)}`);
            return this.parseVariantInfo(response.data);
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                return null;
            }
            throw error;
        }
    }
    parseVariantInfo(data) {
        return {
            id: data.id || data.pharmgkbAccessionId,
            name: data.name,
            rsid: data.rsid,
            gene: data.gene?.symbol,
            variantType: data.variantType,
            location: data.location,
            hasClinicalAnnotations: data.hasClinicalAnnotation,
            hasGuidelines: data.hasGuideline,
            crossReferences: data.crossReferences?.map((xref) => ({
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
    async getClinicalAnnotationsForGene(gene) {
        const response = await this.request('/data/clinicalAnnotation', {
            gene: gene,
        });
        const data = response.data || [];
        return data.map((annotation) => this.parseClinicalAnnotation(annotation));
    }
    /**
     * Get clinical annotations for a drug
     */
    async getClinicalAnnotationsForDrug(drug) {
        const response = await this.request('/data/clinicalAnnotation', {
            chemical: drug,
        });
        const data = response.data || [];
        return data.map((annotation) => this.parseClinicalAnnotation(annotation));
    }
    /**
     * Get clinical annotations for a drug-gene pair
     */
    async getDrugGeneAnnotations(drug, gene) {
        const response = await this.request('/data/clinicalAnnotation', {
            chemical: drug,
            gene: gene,
        });
        const data = response.data || [];
        return data.map((annotation) => this.parseClinicalAnnotation(annotation));
    }
    parseClinicalAnnotation(data) {
        return {
            id: data.id,
            gene: data.gene?.symbol || data.genes?.[0]?.symbol,
            drug: data.chemical?.name || data.chemicals?.[0]?.name,
            variant: data.variant?.name,
            phenotypeCategory: normalizePhenotypeCategory(data.phenotypeCategory),
            levelOfEvidence: parseEvidenceLevel(data.levelOfEvidence),
            annotation: data.text,
            alleles: data.alleles,
            phenotypes: data.phenotypes?.map((p) => p.name),
            populations: data.populations,
            relatedChemicals: data.chemicals?.map((c) => c.name),
            relatedGenes: data.genes?.map((g) => g.symbol),
            pmids: data.literature?.map((l) => l.pmid),
        };
    }
    // =============== Dosing Guideline Methods ===============
    /**
     * Get dosing guidelines for a gene
     */
    async getDosingGuidelinesForGene(gene) {
        const response = await this.request('/data/guideline', {
            gene: gene,
        });
        const data = response.data || [];
        return data.map((guideline) => this.parseDosingGuideline(guideline));
    }
    /**
     * Get dosing guidelines for a drug
     */
    async getDosingGuidelinesForDrug(drug) {
        const response = await this.request('/data/guideline', {
            chemical: drug,
        });
        const data = response.data || [];
        return data.map((guideline) => this.parseDosingGuideline(guideline));
    }
    parseDosingGuideline(data) {
        return {
            id: data.id,
            name: data.name,
            source: parseGuidelineSource(data.name || data.source),
            genes: data.genes?.map((g) => g.symbol) || [],
            drugs: data.chemicals?.map((c) => c.name) || [],
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
    async getDrugLabels(drug) {
        const response = await this.request('/data/labelAnnotation', {
            chemical: drug,
        });
        const data = response.data || [];
        return data.map((label) => this.parseDrugLabel(label));
    }
    parseDrugLabel(data) {
        return {
            id: data.id,
            name: data.name,
            drug: data.chemical?.name,
            source: data.source,
            agency: data.agency,
            approvalDate: data.approvalDate,
            biomarkerCategory: data.biomarkerCategory,
            genes: data.genes?.map((g) => g.symbol),
            variants: data.variants?.map((v) => v.name),
            labelText: data.text,
            url: data.url,
        };
    }
    // =============== Pathway Methods ===============
    /**
     * Get pathways
     */
    async getPathways(query) {
        const params = query ? { q: query } : {};
        const response = await this.request('/data/pathway', params);
        const data = response.data || [];
        return data.map((pathway) => ({
            id: pathway.id,
            name: pathway.name,
            type: pathway.type,
            description: pathway.description,
            genes: pathway.genes?.map((g) => g.symbol),
            drugs: pathway.chemicals?.map((c) => c.name),
            url: pathway.url || `https://www.pharmgkb.org/pathway/${pathway.id}`,
        }));
    }
    /**
     * Get pathways for a gene
     */
    async getGenePathways(gene) {
        const response = await this.request('/data/pathway', {
            gene: gene,
        });
        const data = response.data || [];
        return data.map((pathway) => ({
            id: pathway.id,
            name: pathway.name,
            type: pathway.type,
            description: pathway.description,
            genes: pathway.genes?.map((g) => g.symbol),
            drugs: pathway.chemicals?.map((c) => c.name),
            url: pathway.url || `https://www.pharmgkb.org/pathway/${pathway.id}`,
        }));
    }
    // =============== Drug-Gene Interaction Methods ===============
    /**
     * Get all drug-gene interactions for a gene
     */
    async getDrugGeneInteractions(gene) {
        const annotations = await this.getClinicalAnnotationsForGene(gene);
        const guidelines = await this.getDosingGuidelinesForGene(gene);
        // Aggregate interactions
        const interactionMap = new Map();
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
                }
                else {
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
    async getDatabaseStats() {
        // PharmGKB doesn't have a direct stats endpoint, so we query each type
        const [genes, drugs, variants, annotations, guidelines, labels, pathways] = await Promise.all([
            this.request('/data/gene', { limit: 1 }),
            this.request('/data/chemical', { limit: 1 }),
            this.request('/data/variant', { limit: 1 }),
            this.request('/data/clinicalAnnotation', { limit: 1 }),
            this.request('/data/guideline', { limit: 1 }),
            this.request('/data/labelAnnotation', { limit: 1 }),
            this.request('/data/pathway', { limit: 1 }),
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
    clearCache() {
        this.cache.clear();
    }
    getCacheStats() {
        return {
            size: this.cache.size,
            entries: this.cache.size,
        };
    }
}
// Global client instance
let _client = null;
export function initializeClient(options) {
    _client = new PharmGKBClient(options);
    return _client;
}
export function getClient() {
    if (!_client) {
        throw new Error('PharmGKBClient not initialized. Call initializeClient() first.');
    }
    return _client;
}
export function closeClient() {
    if (_client) {
        _client.clearCache();
        _client = null;
    }
}
//# sourceMappingURL=client.js.map