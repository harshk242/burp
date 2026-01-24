/**
 * Removes null and undefined values from an object
 * Used to clean up variables before sending to GraphQL API
 */
export declare function filterNoneValues<T extends Record<string, unknown>>(variables: T): Partial<T>;
/**
 * Generates a deterministic cache key from query and variables
 */
export declare function generateCacheKey(query: string, variables?: Record<string, unknown>): string;
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
 * Formats an Ensembl gene ID
 */
export declare function formatEnsemblId(id: string): string;
/**
 * Formats an EFO disease ID
 */
export declare function formatEfoId(id: string): string;
/**
 * Formats a ChEMBL drug ID
 */
export declare function formatChemblId(id: string): string;
/**
 * Truncates an array with a size limit
 */
export declare function truncateArray<T>(arr: T[], size: number): T[];
//# sourceMappingURL=utils.d.ts.map