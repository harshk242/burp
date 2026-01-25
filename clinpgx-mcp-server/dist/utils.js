// Utility functions for ClinPGx MCP Server
import { createHash } from 'crypto';
/**
 * Removes null and undefined values from an object
 */
export function filterNoneValues(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
/**
 * Generates a deterministic cache key from endpoint and params
 */
export function generateCacheKey(endpoint, params) {
    const normalizedParams = params
        ? JSON.stringify(params, Object.keys(params).sort())
        : '';
    const content = `${endpoint}:${normalizedParams}`;
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
 * Truncates an array with a size limit
 */
export function truncateArray(arr, size) {
    if (size <= 0) {
        return arr;
    }
    return arr.slice(0, size);
}
/**
 * Validates a PharmGKB accession ID (PA format)
 */
export function validatePharmGKBId(id) {
    return /^PA\d+$/.test(id);
}
/**
 * Formats a gene symbol to uppercase
 */
export function formatGeneSymbol(symbol) {
    return symbol.toUpperCase().trim();
}
/**
 * Formats a drug name (capitalize first letter)
 */
export function formatDrugName(name) {
    return name.trim();
}
/**
 * Formats rsID (adds 'rs' prefix if missing)
 */
export function formatRsId(id) {
    const cleaned = id.replace(/^rs/i, '').replace(/[^0-9]/g, '');
    if (!cleaned) {
        throw new Error(`Invalid rsID: ${id}`);
    }
    return `rs${cleaned}`;
}
/**
 * Parse guideline source from name
 */
export function parseGuidelineSource(name) {
    const lower = name.toLowerCase();
    if (lower.includes('cpic'))
        return 'CPIC';
    if (lower.includes('dpwg') || lower.includes('dutch'))
        return 'DPWG';
    return 'Other';
}
/**
 * Parse evidence level
 * Handles both string values and object values with 'term' property
 */
export function parseEvidenceLevel(level) {
    if (!level)
        return 'Unknown';
    // Handle object with term property (from API response)
    let levelStr;
    if (typeof level === 'object' && level !== null && 'term' in level) {
        levelStr = String(level.term);
    }
    else if (typeof level === 'string') {
        levelStr = level;
    }
    else {
        return 'Unknown';
    }
    const normalized = levelStr.toLowerCase().trim();
    const mappings = {
        '1a': 'Level 1A - High evidence',
        '1b': 'Level 1B - Moderate evidence',
        '2a': 'Level 2A - Moderate-low evidence',
        '2b': 'Level 2B - Low evidence',
        '3': 'Level 3 - Annotation',
        '4': 'Level 4 - Limited evidence',
    };
    for (const [key, value] of Object.entries(mappings)) {
        if (normalized.includes(key)) {
            return value;
        }
    }
    return levelStr;
}
/**
 * Extract PharmGKB ID from various formats
 */
export function extractPharmGKBId(input) {
    // Direct PA ID
    const paMatch = input.match(/PA\d+/);
    if (paMatch)
        return paMatch[0];
    return null;
}
/**
 * Build search query for PharmGKB
 */
export function buildSearchQuery(type, term, options) {
    let query = term;
    if (options?.hasGuidelines) {
        query += '&view=guideline';
    }
    if (options?.hasAnnotations) {
        query += '&view=clinicalAnnotation';
    }
    if (options?.hasLabels) {
        query += '&view=labelAnnotation';
    }
    return query;
}
/**
 * Normalize phenotype category
 * Handles string, array, or undefined inputs
 */
export function normalizePhenotypeCategory(category) {
    if (!category)
        return 'Unknown';
    // Handle array input (from types field)
    let categoryStr;
    if (Array.isArray(category)) {
        categoryStr = category[0] || 'Unknown';
    }
    else if (typeof category === 'string') {
        categoryStr = category;
    }
    else {
        return 'Unknown';
    }
    const mappings = {
        'efficacy': 'Efficacy',
        'dosage': 'Dosage',
        'toxicity': 'Toxicity/ADR',
        'metabolism': 'Metabolism/PK',
        'pk': 'Metabolism/PK',
        'pharmacokinetics': 'Metabolism/PK',
        'other': 'Other',
    };
    const lower = categoryStr.toLowerCase();
    for (const [key, value] of Object.entries(mappings)) {
        if (lower.includes(key)) {
            return value;
        }
    }
    return categoryStr;
}
//# sourceMappingURL=utils.js.map