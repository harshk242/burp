// Utility functions for Open Targets MCP
import { createHash } from 'crypto';
/**
 * Removes null and undefined values from an object
 * Used to clean up variables before sending to GraphQL API
 */
export function filterNoneValues(variables) {
    const result = {};
    for (const [key, value] of Object.entries(variables)) {
        if (value !== null && value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
/**
 * Generates a deterministic cache key from query and variables
 */
export function generateCacheKey(query, variables) {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    const normalizedVars = variables
        ? JSON.stringify(variables, Object.keys(variables).sort())
        : '';
    const content = `${normalizedQuery}:${normalizedVars}`;
    return createHash('sha256').update(content).digest('hex');
}
/**
 * Sleep utility for retry delays
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Calculates exponential backoff delay
 */
export function calculateBackoff(attempt, baseDelay = 1000) {
    return Math.pow(2, attempt) * baseDelay;
}
/**
 * Checks if an HTTP status code is retryable
 */
export function isRetryableStatus(status) {
    return status >= 500 || status === 429;
}
/**
 * Formats an Ensembl gene ID
 */
export function formatEnsemblId(id) {
    return id.toUpperCase().startsWith('ENSG') ? id : `ENSG${id}`;
}
/**
 * Formats an EFO disease ID
 */
export function formatEfoId(id) {
    if (id.toUpperCase().startsWith('EFO_')) {
        return id;
    }
    if (id.toUpperCase().startsWith('EFO:')) {
        return id.replace(':', '_');
    }
    return `EFO_${id}`;
}
/**
 * Formats a ChEMBL drug ID
 */
export function formatChemblId(id) {
    if (id.toUpperCase().startsWith('CHEMBL')) {
        return id.toUpperCase();
    }
    return `CHEMBL${id}`;
}
/**
 * Truncates an array with a size limit
 */
export function truncateArray(arr, size) {
    if (size <= 0) {
        return arr;
    }
    return arr.slice(0, size);
}
//# sourceMappingURL=utils.js.map