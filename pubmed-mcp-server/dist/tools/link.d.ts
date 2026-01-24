/**
 * Find related articles for a given PMID
 */
export declare function findRelatedArticles(pmid: string, maxResults?: number): Promise<{
    sourceId: string;
    relatedIds: string[];
    count: number;
}>;
/**
 * Get articles that cite the given article
 */
export declare function getCitations(pmid: string, maxResults?: number): Promise<{
    sourceId: string;
    citingArticles: string[];
    count: number;
}>;
/**
 * Get references (articles cited by the given article)
 */
export declare function getReferences(pmid: string, maxResults?: number): Promise<{
    sourceId: string;
    references: string[];
    count: number;
}>;
/**
 * Get citation metrics for an article
 */
export declare function getCitationMetrics(pmid: string): Promise<{
    pmid: string;
    citedByCount: number;
    referencesCount: number;
    relatedCount: number;
}>;
//# sourceMappingURL=link.d.ts.map