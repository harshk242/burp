/**
 * List diseases linked to a target with association scores.
 */
export declare function getTargetAssociatedDiseases(ensemblId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Return compounds with known activity on the target.
 */
export declare function getTargetKnownDrugs(ensemblId: string, _pageIndex?: number, _pageSize?: number): Promise<unknown>;
/**
 * Return literature co-occurrence records for a target.
 */
export declare function getTargetLiteratureOccurrences(ensemblId: string, additionalEntityIds?: string[], startYear?: number, endYear?: number, startMonth?: number, endMonth?: number, cursor?: string, size?: number): Promise<unknown>;
//# sourceMappingURL=associations.d.ts.map