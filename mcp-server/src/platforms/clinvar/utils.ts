import { createHash } from 'crypto';
import { isRecord } from '../../shared/json.js';

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

export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function extractText(obj: unknown): string {
  if (typeof obj === 'string') {
    return obj;
  }
  if (typeof obj === 'number') {
    return String(obj);
  }
  if (isRecord(obj)) {
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

export function truncateArray<T>(arr: T[], size: number): T[] {
  if (size <= 0) {
    return arr;
  }
  return arr.slice(0, size);
}

export function formatVariationId(id: string): string {
  const cleaned = id.replace(/[^0-9]/g, '');
  if (!cleaned) {
    throw new Error(`Invalid ClinVar variation ID: ${id}`);
  }
  return cleaned;
}

export function formatAccession(accession: string): string {
  const upper = accession.toUpperCase().trim();
  if (!upper.match(/^(VCV|RCV)\d+(\.\d+)?$/)) {
    throw new Error(`Invalid ClinVar accession format: ${accession}`);
  }
  return upper;
}

export function parseCoordinates(coordStr: string): {
  chromosome?: string;
  start?: number;
  stop?: number;
  ref?: string;
  alt?: string;
} {
  const simpleMatch = coordStr.match(/^chr(\w+):(\d+)(?:-(\d+))?$/i);
  if (simpleMatch) {
    const [, chromosome = '', start = '', stop = start] = simpleMatch;
    return {
      chromosome,
      start: parseInt(start, 10),
      stop: parseInt(stop, 10),
    };
  }

  const hgvsMatch = coordStr.match(/NC_0+(\d+)\.\d+:g\.(\d+)([ACGT]+)>([ACGT]+)/i);
  if (hgvsMatch) {
    const [, chromosome = '', position = '', ref = '', alt = ''] = hgvsMatch;
    return {
      chromosome,
      start: parseInt(position, 10),
      stop: parseInt(position, 10),
      ref,
      alt,
    };
  }

  return {};
}

export function formatRsId(id: string): string {
  const cleaned = id.replace(/^rs/i, '').replace(/[^0-9]/g, '');
  if (!cleaned) {
    throw new Error(`Invalid rsID: ${id}`);
  }
  return `rs${cleaned}`;
}

export function toVariationId(id: string): string {
  return id.trim().replace(/^VCV0*/i, '').replace(/\.\d+$/, '');
}

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

  // hasOwn keeps inherited keys such as "constructor" from matching.
  return Object.hasOwn(mappings, lower) ? (mappings[lower] ?? sig) : sig;
}

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

export function buildClinVarSearchTerm(params: {
  gene?: string | undefined;
  condition?: string;
  clinicalSignificance?: string | undefined;
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
    const significance = params.clinicalSignificance.trim().toLowerCase().replace(/\s+/g, '_');
    // NCBI's property vocabulary abbreviates uncertain significance as VUS.
    terms.push(`clinsig_${significance === 'uncertain_significance' ? 'vus' : significance}[prop]`);
  }
  if (params.molecularConsequence) {
    // ClinVar indexes donor and acceptor consequences separately.
    terms.push(params.molecularConsequence === 'splice site variant'
      ? '("splice donor variant"[mcns] OR "splice acceptor variant"[mcns])'
      : `"${params.molecularConsequence}"[mcns]`);
  }
  if (params.reviewStatus) {
    terms.push(`"${params.reviewStatus}"[review status]`);
  }
  if (params.chromosome) {
    terms.push(`"${params.chromosome}"[chr]`);
  }

  return terms.join(' AND ');
}
