// Utility functions for ClinVar MCP Server
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
 * Ensures a value is an array
 */
export function ensureArray(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
/**
 * Extracts text content from potentially nested XML structure
 */
export function extractText(obj) {
    if (typeof obj === 'string') {
        return obj;
    }
    if (typeof obj === 'number') {
        return String(obj);
    }
    if (obj && typeof obj === 'object') {
        if ('#text' in obj) {
            return String(obj['#text']);
        }
        for (const key of ['_', 'text', 'value', '$t']) {
            if (key in obj) {
                return String(obj[key]);
            }
        }
    }
    return '';
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
 * Validates and formats a ClinVar variation ID
 */
export function formatVariationId(id) {
    const cleaned = id.replace(/[^0-9]/g, '');
    if (!cleaned) {
        throw new Error(`Invalid ClinVar variation ID: ${id}`);
    }
    return cleaned;
}
/**
 * Validates and formats a ClinVar accession (VCV or RCV)
 */
export function formatAccession(accession) {
    const upper = accession.toUpperCase().trim();
    if (!upper.match(/^(VCV|RCV)\d+(\.\d+)?$/)) {
        throw new Error(`Invalid ClinVar accession format: ${accession}`);
    }
    return upper;
}
/**
 * Parses genomic coordinates from string format
 * Supports formats like: chr1:12345, chr1:12345-12350, NC_000001.11:g.12345A>G
 */
export function parseCoordinates(coordStr) {
    // Simple chr:pos format
    const simpleMatch = coordStr.match(/^chr(\w+):(\d+)(?:-(\d+))?$/i);
    if (simpleMatch) {
        return {
            chromosome: simpleMatch[1],
            start: parseInt(simpleMatch[2], 10),
            stop: simpleMatch[3] ? parseInt(simpleMatch[3], 10) : parseInt(simpleMatch[2], 10),
        };
    }
    // HGVS genomic format
    const hgvsMatch = coordStr.match(/NC_0+(\d+)\.\d+:g\.(\d+)([ACGT]+)>([ACGT]+)/i);
    if (hgvsMatch) {
        return {
            chromosome: hgvsMatch[1],
            start: parseInt(hgvsMatch[2], 10),
            stop: parseInt(hgvsMatch[2], 10),
            ref: hgvsMatch[3],
            alt: hgvsMatch[4],
        };
    }
    return {};
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
 * Maps clinical significance string to normalized form
 */
export function normalizeClinicalSignificance(sig) {
    const lower = sig.toLowerCase().trim();
    const mappings = {
        'pathogenic': 'Pathogenic',
        'likely pathogenic': 'Likely pathogenic',
        'uncertain significance': 'Uncertain significance',
        'likely benign': 'Likely benign',
        'benign': 'Benign',
        'conflicting': 'Conflicting interpretations of pathogenicity',
        'conflicting interpretations': 'Conflicting interpretations of pathogenicity',
        'drug response': 'drug response',
        'risk factor': 'risk factor',
        'protective': 'protective',
        'association': 'association',
        'affects': 'affects',
        'not provided': 'not provided',
    };
    for (const [key, value] of Object.entries(mappings)) {
        if (lower.includes(key)) {
            return value;
        }
    }
    return sig;
}
/**
 * Maps review status string to normalized form
 */
export function normalizeReviewStatus(status) {
    const lower = status.toLowerCase().trim();
    const mappings = {
        'practice guideline': 'practice guideline',
        'expert panel': 'reviewed by expert panel',
        'multiple submitters': 'criteria provided, multiple submitters, no conflicts',
        'conflicting': 'criteria provided, conflicting interpretations',
        'single submitter': 'criteria provided, single submitter',
        'no assertion criteria': 'no assertion criteria provided',
        'no assertion provided': 'no assertion provided',
    };
    for (const [key, value] of Object.entries(mappings)) {
        if (lower.includes(key)) {
            return value;
        }
    }
    return status;
}
/**
 * Builds ClinVar search term
 */
export function buildClinVarSearchTerm(params) {
    const terms = [];
    if (params.gene) {
        terms.push(`"${params.gene}"[gene]`);
    }
    if (params.condition) {
        terms.push(`"${params.condition}"[dis]`);
    }
    if (params.clinicalSignificance) {
        terms.push(`"${params.clinicalSignificance}"[clinsig]`);
    }
    if (params.molecularConsequence) {
        terms.push(`"${params.molecularConsequence}"[molecular consequence]`);
    }
    if (params.reviewStatus) {
        terms.push(`"${params.reviewStatus}"[review status]`);
    }
    if (params.chromosome) {
        terms.push(`"${params.chromosome}"[chr]`);
    }
    return terms.join(' AND ');
}
//# sourceMappingURL=utils.js.map