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
     * Search for genes by symbol
     * PharmGKB API uses 'symbol' parameter for gene search
     * If no query is provided, returns CPIC pharmacogenes
     */
    async searchGenes(query, maxResults = 20) {
        try {
            // PharmGKB API requires at least one search parameter
            // If empty query, use cpicGene=true to get pharmacogenes
            const params = query && query.trim()
                ? { symbol: query }
                : { cpicGene: true };
            const response = await this.request('/data/gene', params);
            const data = response.data || [];
            const results = data.slice(0, maxResults).map((gene) => this.parseGeneInfo(gene));
            return {
                totalCount: response.total || results.length,
                results,
                query: query || 'CPIC pharmacogenes',
            };
        }
        catch (error) {
            // If 404 (no results), return empty result instead of throwing
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
    async getGeneInfo(idOrSymbol) {
        try {
            // If it's a PharmGKB accession ID (starts with PA), use direct lookup
            if (idOrSymbol.startsWith('PA')) {
                const response = await this.request(`/data/gene/${encodeURIComponent(idOrSymbol)}`);
                return this.parseGeneInfo(response.data);
            }
            // For gene symbols, use search endpoint with symbol parameter
            const response = await this.request('/data/gene', {
                symbol: idOrSymbol,
            });
            const data = response.data || [];
            if (data.length === 0) {
                return null;
            }
            return this.parseGeneInfo(data[0]);
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
     * Search for drugs by name
     * PharmGKB API uses 'name' parameter for chemical/drug search
     */
    async searchDrugs(query, maxResults = 20) {
        try {
            // PharmGKB API requires at least one search parameter
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
            const data = response.data || [];
            const results = data.slice(0, maxResults).map((drug) => this.parseDrugInfo(drug));
            return {
                totalCount: response.total || results.length,
                results,
                query,
            };
        }
        catch (error) {
            // If 404 (no results), return empty result instead of throwing
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
    async getDrugInfo(idOrName) {
        try {
            // If it's a PharmGKB accession ID (starts with PA), use direct lookup
            if (idOrName.startsWith('PA')) {
                const response = await this.request(`/data/chemical/${encodeURIComponent(idOrName)}`);
                return this.parseDrugInfo(response.data);
            }
            // For drug names, use search endpoint with name parameter
            const response = await this.request('/data/chemical', {
                name: idOrName,
            });
            const data = response.data || [];
            if (data.length === 0) {
                return null;
            }
            return this.parseDrugInfo(data[0]);
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
     * Search for variants by rsID or symbol
     * PharmGKB API uses 'symbol' parameter for variant search
     */
    async searchVariants(query, maxResults = 20) {
        try {
            // PharmGKB API requires at least one search parameter
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
            const data = response.data || [];
            const results = data.slice(0, maxResults).map((variant) => this.parseVariantInfo(variant));
            return {
                totalCount: response.total || results.length,
                results,
                query,
            };
        }
        catch (error) {
            // If 404 (no results), return empty result instead of throwing
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
    async getVariantInfo(idOrRsId) {
        try {
            // If it's a PharmGKB accession ID (starts with PA), use direct lookup
            if (idOrRsId.startsWith('PA')) {
                const response = await this.request(`/data/variant/${encodeURIComponent(idOrRsId)}`);
                return this.parseVariantInfo(response.data);
            }
            // For rsIDs, use search endpoint with symbol parameter
            const response = await this.request('/data/variant', {
                symbol: idOrRsId,
            });
            const data = response.data || [];
            if (data.length === 0) {
                return null;
            }
            return this.parseVariantInfo(data[0]);
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
     * PharmGKB API uses 'location.genes.symbol' parameter
     */
    async getClinicalAnnotationsForGene(gene) {
        try {
            const response = await this.request('/data/clinicalAnnotation', {
                'location.genes.symbol': gene,
            });
            const data = response.data || [];
            return data.map((annotation) => this.parseClinicalAnnotation(annotation));
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                return [];
            }
            throw error;
        }
    }
    /**
     * Get clinical annotations for a drug
     * PharmGKB API uses 'relatedChemicals.name' parameter
     */
    async getClinicalAnnotationsForDrug(drug) {
        try {
            const response = await this.request('/data/clinicalAnnotation', {
                'relatedChemicals.name': drug,
            });
            const data = response.data || [];
            return data.map((annotation) => this.parseClinicalAnnotation(annotation));
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                return [];
            }
            throw error;
        }
    }
    /**
     * Get clinical annotations for a drug-gene pair
     */
    async getDrugGeneAnnotations(drug, gene) {
        try {
            const response = await this.request('/data/clinicalAnnotation', {
                'relatedChemicals.name': drug,
                'location.genes.symbol': gene,
            });
            const data = response.data || [];
            return data.map((annotation) => this.parseClinicalAnnotation(annotation));
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                return [];
            }
            throw error;
        }
    }
    parseClinicalAnnotation(data) {
        // Extract level of evidence - can be an object with 'term' property or a string
        const levelOfEvidence = data.levelOfEvidence;
        const evidenceLevel = typeof levelOfEvidence === 'object' && levelOfEvidence !== null
            ? levelOfEvidence.term
            : levelOfEvidence;
        // Extract genes from location.genes
        const genes = data.location?.genes || data.genes || [];
        const geneSymbol = genes[0]?.symbol;
        // Extract chemicals from relatedChemicals
        const chemicals = data.relatedChemicals || data.chemicals || [];
        const drugName = chemicals[0]?.name;
        // Extract phenotype category from types array (not phenotypeCategory which doesn't exist)
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
            alleles: data.allelePhenotypes?.map((ap) => ap.allele),
            phenotypes: data.phenotypes?.map((p) => typeof p === 'string' ? p : p.name),
            populations: data.populations,
            relatedChemicals: chemicals.map((c) => c.name),
            relatedGenes: genes.map((g) => g.symbol),
            pmids: data.literature?.map((l) => l.pmid),
        };
    }
    // =============== Dosing Guideline Methods ===============
    /**
     * Get dosing guidelines for a gene
     * PharmGKB API uses 'relatedGenes.symbol' parameter for guidelineAnnotation
     */
    async getDosingGuidelinesForGene(gene) {
        const response = await this.request('/data/guidelineAnnotation', {
            'relatedGenes.symbol': gene,
        });
        const data = response.data || [];
        return data.map((guideline) => this.parseDosingGuideline(guideline));
    }
    /**
     * Get dosing guidelines for a drug
     * PharmGKB API uses 'relatedChemicals.name' parameter for guidelineAnnotation
     */
    async getDosingGuidelinesForDrug(drug) {
        const response = await this.request('/data/guidelineAnnotation', {
            'relatedChemicals.name': drug,
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
     * PharmGKB API uses 'relatedChemicals.name' parameter for labelAnnotation
     */
    async getDrugLabels(drug) {
        const response = await this.request('/data/labelAnnotation', {
            'relatedChemicals.name': drug,
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
     * Get pathways by gene symbol
     * PharmGKB API uses 'genes.symbol' parameter
     */
    async getPathways(query) {
        // If query provided, search by gene symbol; otherwise get CPIC gene pathways
        const params = query ? { 'genes.symbol': query } : { cpicGene: true };
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
     * PharmGKB API uses 'genes.symbol' parameter
     */
    async getGenePathways(gene) {
        const response = await this.request('/data/pathway', {
            'genes.symbol': gene,
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
     * Note: PharmGKB doesn't have a direct stats endpoint.
     * We query using CPIC gene filter to get representative pharmacogenomic data.
     */
    async getDatabaseStats() {
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
        // Query using cpicGene=true for genes and pathways
        try {
            const [genesResult, pathwaysResult] = await Promise.all([
                this.request('/data/gene', { cpicGene: true }).catch(() => ({ data: [] })),
                this.request('/data/pathway', { cpicGene: true }).catch(() => ({ data: [] })),
            ]);
            stats.genes = genesResult.data?.length || 0;
            stats.pathways = pathwaysResult.data?.length || 0;
        }
        catch {
            // Continue with zeros
        }
        // For other stats, query with a known pharmacogene (CYP2D6)
        try {
            const [annotationsResult, guidelinesResult, labelsResult] = await Promise.all([
                this.request('/data/clinicalAnnotation', { 'location.genes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
                this.request('/data/guidelineAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
                this.request('/data/labelAnnotation', { 'relatedGenes.symbol': 'CYP2D6' }).catch(() => ({ data: [] })),
            ]);
            stats.clinicalAnnotations = annotationsResult.data?.length || 0;
            stats.guidelines = guidelinesResult.data?.length || 0;
            stats.labels = labelsResult.data?.length || 0;
        }
        catch {
            // Continue with zeros
        }
        return stats;
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