import type { VariantInfo, SubmissionRecord, ClinicalSignificance } from '../types.js';
/**
 * Get clinical significance for a variant
 */
export declare function getClinicalSignificance(variationId: string): Promise<{
    variationId: string;
    clinicalSignificance: ClinicalSignificance | null;
    reviewStatus: string | null;
    submissionCount: number;
    conflictingInterpretations: boolean;
    submissions?: Array<{
        submitter: string;
        interpretation: string;
        dateSubmitted?: string;
    }>;
}>;
/**
 * Search variants by condition/disease
 */
export declare function searchByCondition(condition: string, options?: {
    maxResults?: number;
    clinicalSignificance?: string;
}): Promise<{
    condition: string;
    count: number;
    variantIds: string[];
    variants?: VariantInfo[];
}>;
/**
 * Search variants by molecular consequence
 */
export declare function searchByMolecularConsequence(consequence: string, options?: {
    gene?: string;
    maxResults?: number;
}): Promise<{
    consequence: string;
    gene?: string;
    count: number;
    variantIds: string[];
    variants?: VariantInfo[];
}>;
/**
 * Search by review status
 */
export declare function searchByReviewStatus(reviewStatus: string, options?: {
    gene?: string;
    clinicalSignificance?: string;
    maxResults?: number;
}): Promise<{
    reviewStatus: string;
    count: number;
    variantIds: string[];
    variants?: VariantInfo[];
}>;
/**
 * Get variant submissions
 */
export declare function getVariantSubmissions(variationId: string): Promise<{
    variationId: string;
    submissionCount: number;
    submissions: SubmissionRecord[];
}>;
/**
 * Get variant frequency data
 */
export declare function getVariantFrequency(variationId: string): Promise<{
    variationId: string;
    hasFrequencyData: boolean;
    frequencies?: Array<{
        source: string;
        population?: string;
        alleleFrequency?: number;
    }>;
}>;
/**
 * Get pathogenic variants for a gene
 */
export declare function getPathogenicVariantsForGene(gene: string, maxResults?: number): Promise<{
    gene: string;
    count: number;
    variants: VariantInfo[];
}>;
//# sourceMappingURL=clinical-significance.d.ts.map