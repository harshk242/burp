import type { PubMedArticle, ArticleSummary } from '../types.js';
/**
 * Fetch full article details by PMID
 */
export declare function fetchArticleDetails(pmid: string): Promise<PubMedArticle | null>;
/**
 * Get article abstract only
 */
export declare function getArticleAbstract(pmid: string): Promise<{
    pmid: string;
    title: string;
    abstract: string | null;
    authors: string[];
}>;
/**
 * Get article summary (lightweight metadata)
 */
export declare function getArticleSummary(pmid: string): Promise<ArticleSummary | null>;
/**
 * Batch fetch multiple articles
 */
export declare function batchFetchArticles(pmids: string[], includeAbstracts?: boolean): Promise<{
    articles: PubMedArticle[];
    found: number;
    notFound: string[];
}>;
/**
 * Get article summaries for multiple PMIDs
 */
export declare function batchGetSummaries(pmids: string[]): Promise<{
    summaries: ArticleSummary[];
    found: number;
}>;
//# sourceMappingURL=fetch.d.ts.map