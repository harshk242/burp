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
 * Truncates an array with a size limit
 */
export declare function truncateArray<T>(arr: T[], size: number): T[];
/**
 * Validates a PharmGKB accession ID (PA format)
 */
export declare function validatePharmGKBId(id: string): boolean;
/**
 * Formats a gene symbol to uppercase
 */
export declare function formatGeneSymbol(symbol: string): string;
/**
 * Formats a drug name (capitalize first letter)
 */
export declare function formatDrugName(name: string): string;
/**
 * Formats rsID (adds 'rs' prefix if missing)
 */
export declare function formatRsId(id: string): string;
/**
 * Parse guideline source from name
 */
export declare function parseGuidelineSource(name: string): 'CPIC' | 'DPWG' | 'Other';
/**
 * Parse evidence level
 */
export declare function parseEvidenceLevel(level: string | undefined): string;
/**
 * Extract PharmGKB ID from various formats
 */
export declare function extractPharmGKBId(input: string): string | null;
/**
 * Build search query for PharmGKB
 */
export declare function buildSearchQuery(type: 'gene' | 'drug' | 'variant' | 'pathway', term: string, options?: {
    hasGuidelines?: boolean;
    hasAnnotations?: boolean;
    hasLabels?: boolean;
}): string;
/**
 * Normalize phenotype category
 */
export declare function normalizePhenotypeCategory(category: string | undefined): string;
//# sourceMappingURL=utils.d.ts.map