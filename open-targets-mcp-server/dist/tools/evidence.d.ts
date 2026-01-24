/**
 * Retrieve evidence strings linking a target to a disease.
 */
export declare function getTargetDiseaseEvidence(ensemblId: string, efoId: string, datasourceIds?: string[], size?: number, cursor?: string): Promise<unknown>;
/**
 * Inspect evidence for biomarker annotations linking a target and disease.
 */
export declare function getTargetDiseaseBiomarkers(ensemblId: string, efoId: string, size?: number, cursor?: string): Promise<unknown>;
//# sourceMappingURL=evidence.d.ts.map