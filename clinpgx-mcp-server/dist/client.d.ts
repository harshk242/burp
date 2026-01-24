import type { PharmGKBClientOptions, GeneInfo, DrugInfo, VariantInfo, ClinicalAnnotation, DosingGuideline, DrugLabel, Pathway, DrugGeneInteraction, SearchResult } from './types.js';
export declare class PharmGKBClient {
    private readonly cacheTtl;
    private readonly maxRetries;
    private readonly retryDelay;
    private readonly cache;
    private axiosInstance;
    constructor(options?: PharmGKBClientOptions);
    /**
     * Execute a request with caching and retries
     */
    private request;
    /**
     * Search for genes
     */
    searchGenes(query: string, maxResults?: number): Promise<SearchResult<GeneInfo>>;
    /**
     * Get gene info by ID or symbol
     */
    getGeneInfo(idOrSymbol: string): Promise<GeneInfo | null>;
    private parseGeneInfo;
    /**
     * Search for drugs
     */
    searchDrugs(query: string, maxResults?: number): Promise<SearchResult<DrugInfo>>;
    /**
     * Get drug info by ID or name
     */
    getDrugInfo(idOrName: string): Promise<DrugInfo | null>;
    private parseDrugInfo;
    /**
     * Search for variants
     */
    searchVariants(query: string, maxResults?: number): Promise<SearchResult<VariantInfo>>;
    /**
     * Get variant info by ID or rsID
     */
    getVariantInfo(idOrRsId: string): Promise<VariantInfo | null>;
    private parseVariantInfo;
    /**
     * Get clinical annotations for a gene
     */
    getClinicalAnnotationsForGene(gene: string): Promise<ClinicalAnnotation[]>;
    /**
     * Get clinical annotations for a drug
     */
    getClinicalAnnotationsForDrug(drug: string): Promise<ClinicalAnnotation[]>;
    /**
     * Get clinical annotations for a drug-gene pair
     */
    getDrugGeneAnnotations(drug: string, gene: string): Promise<ClinicalAnnotation[]>;
    private parseClinicalAnnotation;
    /**
     * Get dosing guidelines for a gene
     */
    getDosingGuidelinesForGene(gene: string): Promise<DosingGuideline[]>;
    /**
     * Get dosing guidelines for a drug
     */
    getDosingGuidelinesForDrug(drug: string): Promise<DosingGuideline[]>;
    private parseDosingGuideline;
    /**
     * Get drug labels for a drug
     */
    getDrugLabels(drug: string): Promise<DrugLabel[]>;
    private parseDrugLabel;
    /**
     * Get pathways
     */
    getPathways(query?: string): Promise<Pathway[]>;
    /**
     * Get pathways for a gene
     */
    getGenePathways(gene: string): Promise<Pathway[]>;
    /**
     * Get all drug-gene interactions for a gene
     */
    getDrugGeneInteractions(gene: string): Promise<DrugGeneInteraction[]>;
    /**
     * Get database statistics
     */
    getDatabaseStats(): Promise<{
        genes: number;
        drugs: number;
        variants: number;
        clinicalAnnotations: number;
        guidelines: number;
        labels: number;
        pathways: number;
    }>;
    clearCache(): void;
    getCacheStats(): {
        size: number;
        entries: number;
    };
}
export declare function initializeClient(options?: PharmGKBClientOptions): PharmGKBClient;
export declare function getClient(): PharmGKBClient;
export declare function closeClient(): void;
//# sourceMappingURL=client.d.ts.map