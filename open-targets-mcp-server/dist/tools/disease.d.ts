/**
 * Retrieve core metadata for an Open Targets disease entity.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export declare function getDiseaseInfo(efoId: string): Promise<unknown>;
/**
 * List targets associated with a disease, including evidence scores.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export declare function getDiseaseAssociatedTargets(efoId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Fetch HPO phenotype annotations linked to a disease.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export declare function getDiseasePhenotypes(efoId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * List Open Targets Associated Research (OTAR) projects linked to a disease.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export declare function getDiseaseOtarProjects(efoId: string): Promise<unknown>;
//# sourceMappingURL=disease.d.ts.map