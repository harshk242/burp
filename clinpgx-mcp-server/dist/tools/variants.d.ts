import type { VariantInfo, SearchResult, ClinicalAnnotation } from '../types.js';
/**
 * Search for pharmacogenomic variants
 */
export declare function searchVariants(query: string, maxResults?: number): Promise<SearchResult<VariantInfo>>;
/**
 * Get variant information by ID or rsID
 */
export declare function getVariantInfo(variantId: string): Promise<VariantInfo | null>;
/**
 * Get clinical annotations for a specific variant
 */
export declare function getVariantAnnotations(variantId: string): Promise<ClinicalAnnotation[]>;
/**
 * Search variants by gene
 */
export declare function searchVariantsByGene(gene: string, maxResults?: number): Promise<VariantInfo[]>;
/**
 * Get variants with clinical annotations
 */
export declare function getVariantsWithAnnotations(gene: string): Promise<VariantInfo[]>;
/**
 * Get star alleles for a gene (CYP genes typically)
 */
export declare function getStarAlleles(gene: string): Promise<VariantInfo[]>;
//# sourceMappingURL=variants.d.ts.map