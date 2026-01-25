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
     * Search for genes by symbol
     * PharmGKB API uses 'symbol' parameter for gene search
     */
    searchGenes(query: string, maxResults?: number): Promise<SearchResult<GeneInfo>>;
    /**
     * Get gene info by ID (PAxxxx) or symbol
     * For symbol lookups, use search and return first result
     */
    getGeneInfo(idOrSymbol: string): Promise<GeneInfo | null>;
    private parseGeneInfo;
    /**
     * Search for drugs by name
     * PharmGKB API uses 'name' parameter for chemical/drug search
     */
    searchDrugs(query: string, maxResults?: number): Promise<SearchResult<DrugInfo>>;
    /**
     * Get drug info by ID (PAxxxx) or name
     */
    getDrugInfo(idOrName: string): Promise<DrugInfo | null>;
    private parseDrugInfo;
    /**
     * Search for variants by rsID or symbol
     * PharmGKB API uses 'symbol' parameter for variant search
     */
    searchVariants(query: string, maxResults?: number): Promise<SearchResult<VariantInfo>>;
    /**
     * Get variant info by ID (PAxxxx) or rsID
     */
    getVariantInfo(idOrRsId: string): Promise<VariantInfo | null>;
    private parseVariantInfo;
    /**
     * Get clinical annotations for a gene
     * PharmGKB API uses 'location.genes.symbol' parameter
     */
    getClinicalAnnotationsForGene(gene: string): Promise<ClinicalAnnotation[]>;
    /**
     * Get clinical annotations for a drug
     * PharmGKB API uses 'relatedChemicals.name' parameter
     */
    getClinicalAnnotationsForDrug(drug: string): Promise<ClinicalAnnotation[]>;
    /**
     * Get clinical annotations for a drug-gene pair
     */
    getDrugGeneAnnotations(drug: string, gene: string): Promise<ClinicalAnnotation[]>;
    private parseClinicalAnnotation;
    /**
     * Get dosing guidelines for a gene
     * PharmGKB API uses 'relatedGenes.symbol' parameter for guidelineAnnotation
     */
    getDosingGuidelinesForGene(gene: string): Promise<DosingGuideline[]>;
    /**
     * Get dosing guidelines for a drug
     * PharmGKB API uses 'relatedChemicals.name' parameter for guidelineAnnotation
     */
    getDosingGuidelinesForDrug(drug: string): Promise<DosingGuideline[]>;
    private parseDosingGuideline;
    /**
     * Get drug labels for a drug
     * PharmGKB API uses 'relatedChemicals.name' parameter for labelAnnotation
     */
    getDrugLabels(drug: string): Promise<DrugLabel[]>;
    private parseDrugLabel;
    /**
     * Get pathways by gene symbol
     * PharmGKB API uses 'genes.symbol' parameter
     */
    getPathways(query?: string): Promise<Pathway[]>;
    /**
     * Get pathways for a gene
     * PharmGKB API uses 'genes.symbol' parameter
     */
    getGenePathways(gene: string): Promise<Pathway[]>;
    /**
     * Get all drug-gene interactions for a gene
     */
    getDrugGeneInteractions(gene: string): Promise<DrugGeneInteraction[]>;
    /**
     * Get database statistics
     * Note: PharmGKB doesn't have a direct stats endpoint or support limit parameter.
     * We query using CPIC gene filter to get a representative sample.
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