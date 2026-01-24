/**
 * Retrieve core metadata and functional annotations for a variant.
 */
export declare function getVariantInfo(variantId: string): Promise<unknown>;
/**
 * List credible sets that include a specific variant.
 */
export declare function getVariantCredibleSets(variantId: string, studyTypes?: string[], pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Retrieve pharmacogenomic annotations for a variant.
 */
export declare function getVariantPharmacogenomics(variantId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Retrieve evidence strings linking a variant to targets or diseases.
 */
export declare function getVariantEvidences(variantId: string, datasourceIds?: string[], size?: number, cursor?: string): Promise<unknown>;
/**
 * Retrieve enhancer-to-gene (E2G) predictions overlapping a variant.
 */
export declare function getVariantIntervals(variantId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Retrieve protein-level consequences for a variant.
 */
export declare function getVariantProteinCoordinates(variantId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
//# sourceMappingURL=variant.d.ts.map