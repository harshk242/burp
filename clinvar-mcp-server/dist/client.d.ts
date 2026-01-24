import type { ClinVarClientOptions, VariantInfo, VCVRecord, ClinicalTablesResult } from './types.js';
export declare class ClinVarClient {
    private readonly apiKey?;
    private readonly cacheTtl;
    private readonly maxRetries;
    private readonly retryDelay;
    private readonly cache;
    private readonly rateLimiter;
    private ncbiAxios;
    private clinicalTablesAxios;
    constructor(options?: ClinVarClientOptions);
    /**
     * Execute NCBI E-utilities request with rate limiting, caching, and retries
     */
    private ncbiRequest;
    /**
     * Execute Clinical Tables API request
     */
    private clinicalTablesRequest;
    /**
     * Search ClinVar using E-utilities
     */
    search(term: string, options?: {
        maxResults?: number;
        start?: number;
    }): Promise<{
        count: number;
        ids: string[];
    }>;
    /**
     * Search variants by gene name
     */
    searchByGene(gene: string, options?: {
        maxResults?: number;
        clinicalSignificance?: string;
    }): Promise<{
        count: number;
        ids: string[];
    }>;
    /**
     * Search variants by condition/disease
     */
    searchByCondition(condition: string, options?: {
        maxResults?: number;
        clinicalSignificance?: string;
    }): Promise<{
        count: number;
        ids: string[];
    }>;
    /**
     * Search variants by genomic coordinates
     */
    searchByCoordinates(chromosome: string, start: number, stop?: number, options?: {
        maxResults?: number;
    }): Promise<{
        count: number;
        ids: string[];
    }>;
    /**
     * Get variant summaries by IDs
     */
    getVariantSummaries(ids: string[]): Promise<VariantInfo[]>;
    /**
     * Get full VCV record
     */
    getVCVRecord(variationId: string): Promise<VCVRecord | null>;
    /**
     * Get multiple VCV records
     */
    getVCVRecords(variationIds: string[]): Promise<VCVRecord[]>;
    /**
     * Quick variant lookup using Clinical Tables API
     */
    quickLookup(query: string, maxResults?: number): Promise<ClinicalTablesResult>;
    /**
     * Search by rsID
     */
    searchByRsId(rsId: string): Promise<{
        count: number;
        ids: string[];
    }>;
    /**
     * Search by molecular consequence
     */
    searchByMolecularConsequence(consequence: string, options?: {
        gene?: string;
        maxResults?: number;
    }): Promise<{
        count: number;
        ids: string[];
    }>;
    /**
     * Search by review status
     */
    searchByReviewStatus(reviewStatus: string, options?: {
        gene?: string;
        clinicalSignificance?: string;
        maxResults?: number;
    }): Promise<{
        count: number;
        ids: string[];
    }>;
    clearCache(): void;
    getCacheStats(): {
        size: number;
        entries: number;
    };
    hasApiKey(): boolean;
}
export declare function initializeClient(options?: ClinVarClientOptions): ClinVarClient;
export declare function getClient(): ClinVarClient;
export declare function closeClient(): void;
//# sourceMappingURL=client.d.ts.map