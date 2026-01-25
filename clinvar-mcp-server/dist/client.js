// ClinVar API Client with dual API support (E-utilities + Clinical Tables)
import axios from 'axios';
import { NetworkError, RateLimitError, } from './exceptions.js';
import { filterNoneValues, generateCacheKey, sleep, calculateBackoff, isRetryableStatus, buildClinVarSearchTerm, } from './utils.js';
import { parseESearchResult, parseESummaryResult, parseVCVRecord, } from './xml-parser.js';
import { createRateLimiter } from './rate-limiter.js';
const NCBI_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const CLINICAL_TABLES_URL = 'https://clinicaltables.nlm.nih.gov/api/variants/v4';
const DEFAULT_CACHE_TTL = 3600 * 1000; // 1 hour
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
export class ClinVarClient {
    apiKey;
    cacheTtl;
    maxRetries;
    retryDelay;
    cache;
    rateLimiter;
    ncbiAxios;
    clinicalTablesAxios;
    constructor(options = {}) {
        this.apiKey = options.apiKey || process.env.NCBI_API_KEY;
        this.cacheTtl = options.cacheTtl || DEFAULT_CACHE_TTL;
        this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
        this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
        this.cache = new Map();
        this.rateLimiter = createRateLimiter(!!this.apiKey);
        this.ncbiAxios = axios.create({
            baseURL: NCBI_BASE_URL,
            timeout: 30000,
        });
        this.clinicalTablesAxios = axios.create({
            baseURL: CLINICAL_TABLES_URL,
            timeout: 30000,
        });
    }
    /**
     * Execute NCBI E-utilities request with rate limiting, caching, and retries
     */
    async ncbiRequest(endpoint, params, parser) {
        const fullParams = {
            ...filterNoneValues(params),
            db: 'clinvar',
            ...(this.apiKey ? { api_key: this.apiKey } : {}),
        };
        const cacheKey = generateCacheKey(`ncbi:${endpoint}`, fullParams);
        const cachedEntry = this.cache.get(cacheKey);
        if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
            return cachedEntry.data;
        }
        let lastError;
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                await this.rateLimiter.waitForToken();
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
            catch (error) {
                lastError = error;
                if (axios.isAxiosError(error)) {
                    const axiosError = error;
                    const status = axiosError.response?.status;
                    if (status === 429) {
                        const retryAfter = parseInt(axiosError.response?.headers['retry-after'] || '5', 10);
                        throw new RateLimitError('NCBI rate limit exceeded', retryAfter * 1000);
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
    /**
     * Execute Clinical Tables API request
     */
    async clinicalTablesRequest(params) {
        const cacheKey = generateCacheKey('clinicaltables', params);
        const cachedEntry = this.cache.get(cacheKey);
        if (cachedEntry && Date.now() - cachedEntry.timestamp < this.cacheTtl) {
            return cachedEntry.data;
        }
        try {
            const response = await this.clinicalTablesAxios.get('/search', {
                params: filterNoneValues(params),
            });
            // Clinical Tables returns array: [total, list_of_codes, extra_data, list_of_display_strings]
            const [totalCount, , , displayData] = response.data;
            const variants = (displayData || []).map((item) => ({
                name: item[0] || '',
                gene: item[1] || undefined,
                clinicalSignificance: item[2] || undefined,
                chromosome: item[3] || undefined,
                position: item[4] ? parseInt(item[4], 10) : undefined,
            }));
            const result = {
                totalCount: totalCount || 0,
                variants,
            };
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now(),
            });
            return result;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                throw new NetworkError(`Clinical Tables API error: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Search ClinVar using E-utilities
     */
    async search(term, options) {
        const result = await this.ncbiRequest('/esearch.fcgi', {
            term,
            retmax: options?.maxResults || 20,
            retstart: options?.start || 0,
            retmode: 'xml',
        }, parseESearchResult);
        return {
            count: result.count,
            ids: result.idList,
        };
    }
    /**
     * Search variants by gene name
     */
    async searchByGene(gene, options) {
        const term = buildClinVarSearchTerm({
            gene,
            clinicalSignificance: options?.clinicalSignificance,
        });
        return this.search(term, { maxResults: options?.maxResults });
    }
    /**
     * Search variants by condition/disease
     */
    async searchByCondition(condition, options) {
        const term = buildClinVarSearchTerm({
            condition,
            clinicalSignificance: options?.clinicalSignificance,
        });
        return this.search(term, { maxResults: options?.maxResults });
    }
    /**
     * Search variants by genomic coordinates
     */
    async searchByCoordinates(chromosome, start, stop, options) {
        const coordTerm = stop
            ? `${chromosome}[chr] AND ${start}:${stop}[chrpos37]`
            : `${chromosome}[chr] AND ${start}[chrpos37]`;
        return this.search(coordTerm, { maxResults: options?.maxResults });
    }
    /**
     * Get variant summaries by IDs
     */
    async getVariantSummaries(ids) {
        if (ids.length === 0)
            return [];
        return this.ncbiRequest('/esummary.fcgi', {
            id: ids.join(','),
            retmode: 'xml',
        }, parseESummaryResult);
    }
    /**
     * Get full VCV record
     */
    async getVCVRecord(variationId) {
        const records = await this.ncbiRequest('/efetch.fcgi', {
            id: variationId,
            rettype: 'vcv',
            retmode: 'xml',
        }, parseVCVRecord);
        return records.length > 0 ? records[0] : null;
    }
    /**
     * Get multiple VCV records
     */
    async getVCVRecords(variationIds) {
        if (variationIds.length === 0)
            return [];
        return this.ncbiRequest('/efetch.fcgi', {
            id: variationIds.join(','),
            rettype: 'vcv',
            retmode: 'xml',
        }, parseVCVRecord);
    }
    /**
     * Quick variant lookup using Clinical Tables API
     */
    async quickLookup(query, maxResults = 10) {
        return this.clinicalTablesRequest({
            terms: query,
            maxList: maxResults,
            df: 'Name,GeneSymbol,ClinicalSignificance,Chromosome,Start',
        });
    }
    /**
     * Search by rsID
     */
    async searchByRsId(rsId) {
        const cleanRsId = rsId.replace(/^rs/i, '');
        // Search by rsID directly - ClinVar recognizes rs numbers without field qualifier
        return this.search(`rs${cleanRsId}`);
    }
    /**
     * Search by molecular consequence
     */
    async searchByMolecularConsequence(consequence, options) {
        const term = buildClinVarSearchTerm({
            molecularConsequence: consequence,
            gene: options?.gene,
        });
        return this.search(term, { maxResults: options?.maxResults });
    }
    /**
     * Search by review status
     */
    async searchByReviewStatus(reviewStatus, options) {
        const term = buildClinVarSearchTerm({
            reviewStatus,
            gene: options?.gene,
            clinicalSignificance: options?.clinicalSignificance,
        });
        return this.search(term, { maxResults: options?.maxResults });
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
    hasApiKey() {
        return !!this.apiKey;
    }
}
// Global client instance
let _client = null;
export function initializeClient(options) {
    _client = new ClinVarClient(options);
    return _client;
}
export function getClient() {
    if (!_client) {
        throw new Error('ClinVarClient not initialized. Call initializeClient() first.');
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