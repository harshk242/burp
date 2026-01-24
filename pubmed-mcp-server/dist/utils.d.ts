/**
 * Removes null and undefined values from an object
 */
export declare function filterNoneValues<T extends Record<string, unknown>>(obj: T): Partial<T>;
/**
 * Generates a deterministic cache key from endpoint and params
 */
export declare function generateCacheKey(endpoint: string, params?: Record<string, unknown>): string;
/**
 * Sleep utility for retry delays
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Calculates exponential backoff delay
 */
export declare function calculateBackoff(attempt: number, baseDelay?: number): number;
/**
 * Checks if an HTTP status code is retryable
 */
export declare function isRetryableStatus(status: number): boolean;
/**
 * Validates and formats a PMID
 */
export declare function formatPmid(id: string): string;
/**
 * Validates multiple PMIDs
 */
export declare function formatPmids(ids: string[]): string[];
/**
 * Formats a date for NCBI API (YYYY/MM/DD)
 */
export declare function formatDate(date: Date | string): string;
/**
 * Truncates an array with a size limit
 */
export declare function truncateArray<T>(arr: T[], size: number): T[];
/**
 * Ensures a value is an array
 */
export declare function ensureArray<T>(value: T | T[] | undefined | null): T[];
/**
 * Extracts text content from potentially nested XML structure
 */
export declare function extractText(obj: unknown): string;
/**
 * Safely gets a nested property from an object
 */
export declare function getNestedValue(obj: Record<string, unknown>, path: string): unknown;
/**
 * Builds a PubMed search query with filters
 */
export declare function buildSearchQuery(baseQuery: string, filters?: {
    dateRange?: {
        start: string;
        end: string;
    };
    publicationType?: string[];
    language?: string;
    hasAbstract?: boolean;
    freeFullText?: boolean;
    humanOnly?: boolean;
    journalList?: string[];
}): string;
/**
 * Formats author name for display
 */
export declare function formatAuthorName(author: {
    lastName?: string;
    foreName?: string;
    initials?: string;
    collectiveName?: string;
}): string;
/**
 * Formats a citation in a specified style
 */
export declare function formatCitation(article: {
    authors?: Array<{
        lastName?: string;
        foreName?: string;
        initials?: string;
    }>;
    title?: string;
    journal?: {
        title?: string;
        volume?: string;
        issue?: string;
        pages?: string;
    };
    pubDate?: string;
    pmid?: string;
    doi?: string;
}, style?: 'apa' | 'mla' | 'vancouver' | 'bibtex'): string;
//# sourceMappingURL=utils.d.ts.map