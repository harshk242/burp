/**
 * Retrieve metadata and cohort details for a GWAS study.
 */
export declare function getStudyInfo(studyId: string): Promise<unknown>;
/**
 * List studies linked to one or more diseases.
 */
export declare function getStudiesByDisease(diseaseIds: string[], enableIndirect?: boolean, studyId?: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Retrieve fine-mapped credible sets for a study.
 */
export declare function getStudyCredibleSets(studyId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Fetch detailed information for a specific study locus credible set.
 */
export declare function getCredibleSetById(studyLocusId: string): Promise<unknown>;
/**
 * Retrieve colocalisation results for a credible set.
 */
export declare function getCredibleSetColocalisation(studyLocusId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Query credible sets with flexible filtering options.
 */
export declare function getCredibleSets(studyLocusIds?: string[], studyIds?: string[], variantIds?: string[], studyTypes?: string[], regions?: string[], pageIndex?: number, pageSize?: number): Promise<unknown>;
//# sourceMappingURL=study.d.ts.map