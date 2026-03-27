// Utility functions for PubMed platform module

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
 * Validates and formats a PMID
 */
export function formatPmid(id: string): string {
  const cleaned = id.replace(/[^0-9]/g, '');
  if (!cleaned) {
    throw new Error(`Invalid PMID: ${id}`);
  }
  return cleaned;
}

/**
 * Validates multiple PMIDs
 */
export function formatPmids(ids: string[]): string[] {
  return ids.map(formatPmid);
}

/**
 * Formats a date for NCBI API (YYYY/MM/DD)
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
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
    // Try common text node names
    for (const key of ['_', 'text', 'value', '$t']) {
      if (key in obj) {
        return String((obj as Record<string, unknown>)[key]);
      }
    }
  }
  return '';
}

/**
 * Safely gets a nested property from an object
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Builds a PubMed search query with filters
 */
export function buildSearchQuery(
  baseQuery: string,
  filters?: {
    dateRange?: { start: string; end: string };
    publicationType?: string[];
    language?: string;
    hasAbstract?: boolean;
    freeFullText?: boolean;
    humanOnly?: boolean;
    journalList?: string[];
  }
): string {
  const parts = [baseQuery];

  if (filters) {
    if (filters.dateRange) {
      parts.push(`("${filters.dateRange.start}"[Date - Publication] : "${filters.dateRange.end}"[Date - Publication])`);
    }
    if (filters.publicationType && filters.publicationType.length > 0) {
      const ptQuery = filters.publicationType.map(pt => `"${pt}"[Publication Type]`).join(' OR ');
      parts.push(`(${ptQuery})`);
    }
    if (filters.language) {
      parts.push(`"${filters.language}"[Language]`);
    }
    if (filters.hasAbstract) {
      parts.push('hasabstract');
    }
    if (filters.freeFullText) {
      parts.push('free full text[sb]');
    }
    if (filters.humanOnly) {
      parts.push('"humans"[MeSH Terms]');
    }
    if (filters.journalList && filters.journalList.length > 0) {
      const journalQuery = filters.journalList.map(j => `"${j}"[Journal]`).join(' OR ');
      parts.push(`(${journalQuery})`);
    }
  }

  return parts.join(' AND ');
}

/**
 * Formats author name for display
 */
export function formatAuthorName(author: {
  lastName?: string;
  foreName?: string;
  initials?: string;
  collectiveName?: string;
}): string {
  if (author.collectiveName) {
    return author.collectiveName;
  }
  if (author.lastName && author.foreName) {
    return `${author.lastName} ${author.foreName}`;
  }
  if (author.lastName && author.initials) {
    return `${author.lastName} ${author.initials}`;
  }
  return author.lastName || author.foreName || 'Unknown';
}

/**
 * Formats a citation in a specified style
 */
export function formatCitation(
  article: {
    authors?: Array<{ lastName?: string; foreName?: string; initials?: string }>;
    title?: string;
    journal?: { title?: string; volume?: string; issue?: string; pages?: string };
    pubDate?: string;
    pmid?: string;
    doi?: string;
  },
  style: 'apa' | 'mla' | 'vancouver' | 'bibtex' = 'vancouver'
): string {
  const authors = article.authors || [];
  const title = article.title || 'Untitled';
  const journal = article.journal?.title || 'Unknown Journal';
  const volume = article.journal?.volume || '';
  const issue = article.journal?.issue || '';
  const pages = article.journal?.pages || '';
  const year = article.pubDate?.substring(0, 4) || 'n.d.';
  const pmid = article.pmid || '';
  const doi = article.doi || '';

  switch (style) {
    case 'apa': {
      const authorStr = authors.length > 0
        ? authors.slice(0, 7).map(a => `${a.lastName || ''}, ${a.initials || ''}`).join(', ')
        : 'Unknown Author';
      return `${authorStr} (${year}). ${title}. ${journal}, ${volume}${issue ? `(${issue})` : ''}, ${pages}. ${doi ? `https://doi.org/${doi}` : `PMID: ${pmid}`}`;
    }
    case 'mla': {
      const authorStr = authors.length > 0
        ? `${authors[0].lastName || ''}, ${authors[0].foreName || ''}`
        : 'Unknown Author';
      return `${authorStr}${authors.length > 1 ? ', et al' : ''}. "${title}." ${journal} ${volume}.${issue} (${year}): ${pages}.`;
    }
    case 'bibtex': {
      const key = `${authors[0]?.lastName || 'unknown'}${year}`;
      const authorStr = authors.map(a => `${a.lastName || ''}, ${a.foreName || ''}`).join(' and ');
      return `@article{${key},\n  author = {${authorStr}},\n  title = {${title}},\n  journal = {${journal}},\n  year = {${year}},\n  volume = {${volume}},\n  number = {${issue}},\n  pages = {${pages}},\n  pmid = {${pmid}},\n  doi = {${doi}}\n}`;
    }
    case 'vancouver':
    default: {
      const authorStr = authors.length > 0
        ? authors.slice(0, 6).map(a => `${a.lastName || ''} ${a.initials || ''}`).join(', ')
        : 'Unknown Author';
      return `${authorStr}${authors.length > 6 ? ', et al' : ''}. ${title}. ${journal}. ${year};${volume}${issue ? `(${issue})` : ''}:${pages}. PMID: ${pmid}.`;
    }
  }
}
