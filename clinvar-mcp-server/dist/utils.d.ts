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
 * Ensures a value is an array
 */
export declare function ensureArray<T>(value: T | T[] | undefined | null): T[];
/**
 * Extracts text content from potentially nested XML structure
 */
export declare function extractText(obj: unknown): string;
/**
 * Truncates an array with a size limit
 */
export declare function truncateArray<T>(arr: T[], size: number): T[];
/**
 * Validates and formats a ClinVar variation ID
 */
export declare function formatVariationId(id: string): string;
/**
 * Validates and formats a ClinVar accession (VCV or RCV)
 */
export declare function formatAccession(accession: string): string;
/**
 * Parses genomic coordinates from string format
 * Supports formats like: chr1:12345, chr1:12345-12350, NC_000001.11:g.12345A>G
 */
export declare function parseCoordinates(coordStr: string): {
    chromosome?: string;
    start?: number;
    stop?: number;
    ref?: string;
    alt?: string;
};
/**
 * Formats rsID (adds 'rs' prefix if missing)
 */
export declare function formatRsId(id: string): string;
/**
 * Maps clinical significance string to normalized form
 */
export declare function normalizeClinicalSignificance(sig: string): string;
/**
 * Maps review status string to normalized form
 */
export declare function normalizeReviewStatus(status: string): string;
/**
 * Builds ClinVar search term
 */
export declare function buildClinVarSearchTerm(params: {
    gene?: string;
    condition?: string;
    clinicalSignificance?: string;
    molecularConsequence?: string;
    reviewStatus?: string;
    chromosome?: string;
}): string;
//# sourceMappingURL=utils.d.ts.map