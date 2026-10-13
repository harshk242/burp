// Utility functions for ClinVar platform module

import { createHash } from 'crypto';

/**
 * Removes null and undefined values from an object
 */
export function filterNoneValues<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Generates a deterministic cache key from endpoint and params
 */
export function generateCacheKey(
  endpoint: string,
  params?: Record<string, unknown>
): string {
  const normalizedParams = params
    ? JSON.stringify(params, Object.keys(params).sort())
    : '';
  const content = `${endpoint}:${normalizedParams}`;
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Ensures a value is an array
 */
export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Extracts text content from potentially nested XML structure
 */
export function extractText(obj: unknown): string {
  if (typeof obj === 'string') {
    return obj;
  }
  if (typeof obj === 'number') {
    return String(obj);
  }
  if (obj && typeof obj === 'object') {
    if ('#text' in obj) {
      return String((obj as Record<string, unknown>)['#text']);
    }
    for (const key of ['_', 'text', 'value', '$t']) {
      if (key in obj) {
        return String((obj as Record<string, unknown>)[key]);
      }
    }
  }
  return '';
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

/**
 * Validates and formats a ClinVar variation ID
 */
export function formatVariationId(id: string): string {
  const cleaned = id.replace(/[^0-9]/g, '');
  if (!cleaned) {
    throw new Error(`Invalid ClinVar variation ID: ${id}`);
  }
  return cleaned;
}

/**
 * Validates and formats a ClinVar accession (VCV or RCV)
 */
export function formatAccession(accession: string): string {
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
export function parseCoordinates(coordStr: string): {
  chromosome?: string;
  start?: number;
  stop?: number;
  ref?: string;
  alt?: string;
} {
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
export function formatRsId(id: string): string {
  const cleaned = id.replace(/^rs/i, '').replace(/[^0-9]/g, '');
  if (!cleaned) {
    throw new Error(`Invalid rsID: ${id}`);
  }
  return `rs${cleaned}`;
}

/**
 * Numeric ClinVar variation ID from a variation ID or VCV accession
 * ("VCV000017661.150" -> "17661"), as efetch with is_variationid expects.
 */
export function toVariationId(id: string): string {
  return id.trim().replace(/^VCV0*/i, '').replace(/\.\d+$/, '');
}

/**
 * Maps clinical significance string to normalized form
 */
export function normalizeClinicalSignificance(sig: string): string {
  const lower = sig.toLowerCase().trim();
  const mappings: Record<string, string> = {
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

  // Exact terms only: a substring match would turn "Likely pathogenic" into
  // "Pathogenic" and "Conflicting classifications of pathogenicity" into
  // "Pathogenic". Combined terms ("Pathogenic/Likely pathogenic") stay as given.
  if (Object.hasOwn(mappings, lower)) {
    return mappings[lower];
  }

  return sig;
}

/**
 * Maps review status string to normalized form
 */
export function normalizeReviewStatus(status: string): string {
  const lower = status.toLowerCase().trim();
  const mappings: Record<string, string> = {
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
export function buildClinVarSearchTerm(params: {
  gene?: string;
  condition?: string;
  clinicalSignificance?: string;
  molecularConsequence?: string;
  reviewStatus?: string;
  chromosome?: string;
}): string {
  const terms: string[] = [];

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
