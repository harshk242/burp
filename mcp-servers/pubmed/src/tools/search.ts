// Search tools for PubMed MCP Server

import { getClient } from '../client.js';
import { buildSearchQuery } from '../utils.js';
import type { SearchFilters } from '../types.js';

/**
 * Basic PubMed search
 */
export async function searchPubmed(
  query: string,
  maxResults: number = 20,
  start: number = 0,
  sort?: string
): Promise<{
  count: number;
  pmids: string[];
  queryTranslation: string;
  returnedCount: number;
}> {
  const client = getClient();
  const result = await client.search(query, {
    maxResults,
    start,
    sort,
  });

  return {
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
    returnedCount: result.pmids.length,
  };
}

/**
 * Advanced search with filters
 */
export async function searchWithFilters(
  query: string,
  filters: SearchFilters,
  maxResults: number = 20,
  start: number = 0
): Promise<{
  count: number;
  pmids: string[];
  queryTranslation: string;
  appliedFilters: string[];
}> {
  const client = getClient();
  const fullQuery = buildSearchQuery(query, filters);

  const result = await client.search(fullQuery, {
    maxResults,
    start,
  });

  const appliedFilters: string[] = [];
  if (filters.dateRange) {
    appliedFilters.push(`Date range: ${filters.dateRange.start} to ${filters.dateRange.end}`);
  }
  if (filters.publicationType && filters.publicationType.length > 0) {
    appliedFilters.push(`Publication types: ${filters.publicationType.join(', ')}`);
  }
  if (filters.language) {
    appliedFilters.push(`Language: ${filters.language}`);
  }
  if (filters.hasAbstract) {
    appliedFilters.push('Has abstract');
  }
  if (filters.freeFullText) {
    appliedFilters.push('Free full text');
  }
  if (filters.humanOnly) {
    appliedFilters.push('Human studies only');
  }
  if (filters.journalList && filters.journalList.length > 0) {
    appliedFilters.push(`Journals: ${filters.journalList.join(', ')}`);
  }

  return {
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
    appliedFilters,
  };
}

/**
 * Search by author name
 */
export async function searchByAuthor(
  authorName: string,
  additionalQuery?: string,
  maxResults: number = 20
): Promise<{
  count: number;
  pmids: string[];
  queryTranslation: string;
}> {
  const client = getClient();

  // Format author search query
  let query = `"${authorName}"[Author]`;
  if (additionalQuery) {
    query = `${query} AND (${additionalQuery})`;
  }

  const result = await client.search(query, {
    maxResults,
    sort: 'date',
  });

  return {
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
  };
}

/**
 * Search by journal name
 */
export async function searchByJournal(
  journalName: string,
  additionalQuery?: string,
  maxResults: number = 20,
  minDate?: string,
  maxDate?: string
): Promise<{
  count: number;
  pmids: string[];
  queryTranslation: string;
}> {
  const client = getClient();

  // Format journal search query
  let query = `"${journalName}"[Journal]`;
  if (additionalQuery) {
    query = `${query} AND (${additionalQuery})`;
  }

  const result = await client.search(query, {
    maxResults,
    sort: 'date',
    minDate,
    maxDate,
  });

  return {
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
  };
}

/**
 * Search clinical trials literature
 */
export async function searchClinicalTrialsLiterature(
  condition: string,
  intervention?: string,
  maxResults: number = 20
): Promise<{
  count: number;
  pmids: string[];
  queryTranslation: string;
}> {
  const client = getClient();

  // Build clinical trial search query
  let query = `"${condition}"[MeSH Terms] AND (Clinical Trial[Publication Type] OR Randomized Controlled Trial[Publication Type])`;
  if (intervention) {
    query = `${query} AND "${intervention}"[MeSH Terms]`;
  }

  const result = await client.search(query, {
    maxResults,
    sort: 'date',
  });

  return {
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
  };
}
