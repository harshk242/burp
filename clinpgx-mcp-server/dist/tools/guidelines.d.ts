import type { DosingGuideline, DrugLabel } from '../types.js';
/**
 * Get CPIC/DPWG dosing guidelines for a gene
 */
export declare function getDosingGuidelinesForGene(gene: string): Promise<DosingGuideline[]>;
/**
 * Get CPIC/DPWG dosing guidelines for a drug
 */
export declare function getDosingGuidelinesForDrug(drug: string): Promise<DosingGuideline[]>;
/**
 * Get dosing guidelines by source (CPIC or DPWG)
 */
export declare function getGuidelinesBySource(gene: string, source: 'CPIC' | 'DPWG'): Promise<DosingGuideline[]>;
/**
 * Get FDA/EMA drug labels
 */
export declare function getDrugLabels(drug: string): Promise<DrugLabel[]>;
/**
 * Get all guidelines for a drug-gene pair
 */
export declare function getGuidelinesForDrugGenePair(drug: string, gene: string): Promise<{
    guidelines: DosingGuideline[];
    labels: DrugLabel[];
}>;
/**
 * Get actionable drug-gene pairs (those with guidelines)
 */
export declare function getActionablePairs(gene: string): Promise<Array<{
    drug: string;
    gene: string;
    guidelineCount: number;
}>>;
//# sourceMappingURL=guidelines.d.ts.map