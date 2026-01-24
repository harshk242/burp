/**
 * Return RNA and protein expression profiles for a target across tissues.
 */
export declare function getTargetExpression(ensemblId: string): Promise<unknown>;
/**
 * List pathway memberships and Gene Ontology annotations for a target.
 */
export declare function getTargetPathwaysAndGoTerms(ensemblId: string, _pageIndex?: number, _pageSize?: number): Promise<unknown>;
/**
 * Retrieve cross-species homologues for a target gene.
 */
export declare function getTargetHomologues(ensemblId: string): Promise<unknown>;
/**
 * Return subcellular localisation annotations for a target.
 */
export declare function getTargetSubcellularLocations(ensemblId: string): Promise<unknown>;
/**
 * Fetch genetic constraint metrics (gnomAD) for a target.
 */
export declare function getTargetGeneticConstraint(ensemblId: string): Promise<unknown>;
/**
 * Retrieve mouse knockout phenotypes associated with a target.
 */
export declare function getTargetMousePhenotypes(ensemblId: string, _pageIndex?: number, _pageSize?: number): Promise<unknown>;
/**
 * Return cancer hallmark annotations associated with a target.
 */
export declare function getTargetHallmarks(ensemblId: string): Promise<unknown>;
/**
 * Fetch DepMap CRISPR essentiality scores across cell lines.
 */
export declare function getTargetDepmapEssentiality(ensemblId: string): Promise<unknown>;
/**
 * Retrieve protein interaction partners for a target from curated databases.
 */
export declare function getTargetInteractions(ensemblId: string, sourceDatabase?: string, scoreThreshold?: number, pageIndex?: number, pageSize?: number): Promise<unknown>;
//# sourceMappingURL=biology.d.ts.map