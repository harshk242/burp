import type { VariantInfo, VCVRecord } from '../types.js';
/**
 * Search variants by gene name
 */
export declare function searchVariantsByGene(gene: string, options?: {
    maxResults?: number;
    clinicalSignificance?: string;
}): Promise<{
    gene: string;
    count: number;
    variantIds: string[];
    variants?: VariantInfo[];
}>;
/**
 * Get variant info by variation ID
 */
export declare function getVariantInfo(variationId: string): Promise<VariantInfo | null>;
/**
 * Get full VCV record with all details
 */
export declare function getVCVRecord(variationId: string): Promise<VCVRecord | null>;
/**
 * Lookup variant by genomic coordinates
 */
export declare function lookupByCoordinates(chromosome: string, start: number, stop?: number, options?: {
    maxResults?: number;
}): Promise<{
    coordinates: string;
    count: number;
    variantIds: string[];
    variants?: VariantInfo[];
}>;
/**
 * Lookup variant by rsID
 */
export declare function lookupByRsId(rsId: string): Promise<{
    rsId: string;
    count: number;
    variantIds: string[];
    variants?: VariantInfo[];
}>;
/**
 * Batch lookup multiple variants
 */
export declare function batchVariantLookup(variationIds: string[]): Promise<{
    found: number;
    notFound: string[];
    variants: VariantInfo[];
}>;
/**
 * Quick variant search using Clinical Tables API
 */
export declare function quickVariantSearch(query: string, maxResults?: number): Promise<{
    query: string;
    totalCount: number;
    variants: Array<{
        name: string;
        gene?: string;
        clinicalSignificance?: string;
        chromosome?: string;
        position?: number;
    }>;
}>;
//# sourceMappingURL=variant-lookup.d.ts.map