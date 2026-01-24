import type { PubMedClientOptions, ESearchResult, ArticleSummary, PubMedArticle, LinkResult } from './types.js';
export interface ESearchParams {
    db?: string;
    term: string;
    retmax?: number;
    retstart?: number;
    sort?: string;
    datetype?: string;
    reldate?: number;
    mindate?: string;
    maxdate?: string;
    usehistory?: 'y' | 'n';
}
export interface ESummaryParams {
    db?: string;
    id: string;
    retmode?: string;
}
export interface EFetchParams {
    db?: string;
    id: string;
    rettype?: string;
    retmode?: string;
}
export interface ELinkParams {
    db?: string;
    dbfrom?: string;
    id: string;
    linkname?: string;
    cmd?: string;
}
export declare class PubMedClient {
    private readonly apiKey?;
    private readonly cacheTtl;
    private readonly maxRetries;
    private readonly retryDelay;
    private readonly cache;
    private readonly rateLimiter;
    private axiosInstance;
    constructor(options?: PubMedClientOptions);
    /**
     * Execute a request with rate limiting, caching, and retries
     */
    private request;
    /**
     * ESearch - Search and retrieve UIDs
     */
    esearch(params: ESearchParams): Promise<ESearchResult>;
    /**
     * ESummary - Retrieve document summaries
     */
    esummary(params: ESummaryParams): Promise<ArticleSummary[]>;
    /**
     * EFetch - Retrieve full records
     */
    efetch(params: EFetchParams): Promise<PubMedArticle[]>;
    /**
     * ELink - Find related records
     */
    elink(params: ELinkParams): Promise<LinkResult>;
    /**
     * Search PubMed with a query string
     */
    search(query: string, options?: {
        maxResults?: number;
        start?: number;
        sort?: string;
        minDate?: string;
        maxDate?: string;
    }): Promise<{
        count: number;
        pmids: string[];
        queryTranslation: string;
    }>;
    /**
     * Fetch article details by PMID(s)
     */
    fetchArticles(pmids: string | string[]): Promise<PubMedArticle[]>;
    /**
     * Get article summaries by PMID(s)
     */
    getArticleSummaries(pmids: string | string[]): Promise<ArticleSummary[]>;
    /**
     * Find related articles
     */
    findRelatedArticles(pmid: string): Promise<string[]>;
    /**
     * Get articles that cite the given article
     */
    getCitingArticles(pmid: string): Promise<string[]>;
    /**
     * Get references (articles cited by the given article)
     */
    getReferences(pmid: string): Promise<string[]>;
    /**
     * Clear the cache
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        entries: number;
    };
    /**
     * Check if API key is configured
     */
    hasApiKey(): boolean;
}
/**
 * Initialize the global client
 */
export declare function initializeClient(options?: PubMedClientOptions): PubMedClient;
/**
 * Get the global client instance
 */
export declare function getClient(): PubMedClient;
/**
 * Close the global client (cleanup)
 */
export declare function closeClient(): void;
//# sourceMappingURL=client.d.ts.map