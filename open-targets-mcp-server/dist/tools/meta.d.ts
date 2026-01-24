/**
 * Return Open Targets Platform release metadata.
 */
export declare function getApiMetadata(): Promise<unknown>;
/**
 * List sources contributing target–disease association evidence.
 */
export declare function getAssociationDatasources(): Promise<unknown>;
/**
 * Enumerate interaction databases integrated into Open Targets.
 */
export declare function getInteractionResources(): Promise<unknown>;
/**
 * Resolve Gene Ontology identifiers to human-readable labels.
 */
export declare function getGeneOntologyTerms(goIds: string[]): Promise<unknown>;
/**
 * Map free-text terms to canonical Open Targets identifiers.
 */
export declare function mapIds(queryTerms: string[], entityNames?: string[]): Promise<unknown>;
//# sourceMappingURL=meta.d.ts.map