// Utility functions for Open Targets MCP

import { createHash } from 'crypto';

/**
 * Removes null and undefined values from an object
 * Used to clean up variables before sending to GraphQL API
 */
export function filterNoneValues<T extends Record<string, unknown>>(
  variables: T
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value !== null && value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Generates a deterministic cache key from query and variables
 */
export function generateCacheKey(
  query: string,
  variables?: Record<string, unknown>
): string {
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
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay
 */
export function calculateBackoff(
  attempt: number,
  baseDelay: number = 1000
): number {
  return Math.pow(2, attempt) * baseDelay;
}

/**
 * Checks if an HTTP status code is retryable
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Formats an Ensembl gene ID
 */
export function formatEnsemblId(id: string): string {
  return id.toUpperCase().startsWith('ENSG') ? id : `ENSG${id}`;
}

/**
 * Formats an EFO disease ID
 */
export function formatEfoId(id: string): string {
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
export function formatChemblId(id: string): string {
  if (id.toUpperCase().startsWith('CHEMBL')) {
    return id.toUpperCase();
  }
  return `CHEMBL${id}`;
}

/**
 * Truncates an array with a size limit
 */
export function truncateArray<T>(arr: T[], size: number): T[] {
  if (size <= 0) {
    return arr;
  }
  return arr.slice(0, size);
}
