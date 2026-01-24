/**
 * Search Open Targets entities and resolve synonyms to canonical IDs.
 */
export declare function searchEntities(queryString: string, entityNames?: string[], pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Return autocomplete suggestions for partially typed queries.
 */
export declare function searchSuggestions(queryPrefix: string, entityNames?: string[], maxSuggestions?: number): Promise<unknown>;
/**
 * Identify targets with similar association profiles to the seed target.
 */
export declare function getSimilarTargets(entityId: string, threshold?: number, size?: number): Promise<unknown>;
/**
 * Return facet counts to help filter search results.
 */
export declare function searchFacets(queryString?: string, categoryId?: string, entityNames?: string[], pageIndex?: number, pageSize?: number): Promise<unknown>;
//# sourceMappingURL=search.d.ts.map