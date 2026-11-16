import { getClient } from '../client.js';
import { buildSearchQuery } from '../utils.js';
import type { SearchFilters } from '../types.js';

/** Search hits listed with title, journal and date; more PMIDs than this stay as bare IDs. */
export const MAX_LISTED_ARTICLES = 50;

export const READ_BEFORE_CITING =
  'These are leads, not evidence: a title does not tell you what the study found. Before stating a finding, ' +
  'number or conclusion from any of these, open its abstract with pubmed__batch_fetch_articles (several PMIDs in one call).';

// "Journal Article" is on nearly every record; the informative types are Review, Randomized Controlled Trial,
// Retracted Publication, Preprint and the like.
const UNINFORMATIVE_TYPES = new Set(['Journal Article']);

export interface ListedArticle {
  pmid: string;
  title: string | null;
  journal: string | null;
  pubDate: string | null;
  publicationTypes: string[];
}

export interface ListedSearch {
  count: number;
  pmids: string[];
  queryTranslation: string;
  articles: ListedArticle[];
  next_step?: string;
}

/** Attach titles so the model can pick which records to open; the abstracts themselves stay one call away. */
async function listArticles<T extends { count: number; pmids: string[]; queryTranslation: string }>(
  result: T
): Promise<T & ListedSearch> {
  const listed = result.pmids.slice(0, MAX_LISTED_ARTICLES);
  if (listed.length === 0) return { ...result, articles: [] };
  const summaries = await getClient().getArticleSummaries(listed);
  const byId = new Map(summaries.map((s) => [s.uid, s]));
  const articles = listed.map((pmid) => {
    const summary = byId.get(pmid);
    return {
      pmid,
      title: summary?.title || null,
      journal: summary?.source || null,
      pubDate: summary?.pubdate || null,
      publicationTypes: (summary?.pubtype ?? []).filter((type) => !UNINFORMATIVE_TYPES.has(type)),
    };
  });
  return { ...result, articles, next_step: READ_BEFORE_CITING };
}

export async function searchPubmed(
  query: string,
  maxResults: number = 20,
  start: number = 0,
  sort?: string
): Promise<ListedSearch & {
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

  return listArticles({
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
    returnedCount: result.pmids.length,
  });
}

export async function searchWithFilters(
  query: string,
  filters: SearchFilters,
  maxResults: number = 20,
  start: number = 0
): Promise<ListedSearch & {
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

  return listArticles({
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
    appliedFilters,
  });
}

export async function searchByAuthor(
  authorName: string,
  additionalQuery?: string,
  maxResults: number = 20
): Promise<ListedSearch & {
  count: number;
  pmids: string[];
  queryTranslation: string;
}> {
  const client = getClient();

  let query = `"${authorName}"[Author]`;
  if (additionalQuery) {
    query = `${query} AND (${additionalQuery})`;
  }

  const result = await client.search(query, {
    maxResults,
    sort: 'pub_date',
  });

  return listArticles({
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
  });
}

export async function searchByJournal(
  journalName: string,
  additionalQuery?: string,
  maxResults: number = 20,
  minDate?: string,
  maxDate?: string
): Promise<ListedSearch & {
  count: number;
  pmids: string[];
  queryTranslation: string;
}> {
  const client = getClient();

  let query = `"${journalName}"[Journal]`;
  if (additionalQuery) {
    query = `${query} AND (${additionalQuery})`;
  }

  const result = await client.search(query, {
    maxResults,
    sort: 'pub_date',
    minDate,
    maxDate,
  });

  return listArticles({
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
  });
}

export async function searchClinicalTrialsLiterature(
  condition: string,
  intervention?: string,
  maxResults: number = 20
): Promise<ListedSearch & {
  count: number;
  pmids: string[];
  queryTranslation: string;
}> {
  const client = getClient();

  let query = `"${condition}"[MeSH Terms] AND (Clinical Trial[Publication Type] OR Randomized Controlled Trial[Publication Type])`;
  if (intervention) {
    query = `${query} AND "${intervention}"[MeSH Terms]`;
  }

  const result = await client.search(query, {
    maxResults,
    sort: 'pub_date',
  });

  return listArticles({
    count: result.count,
    pmids: result.pmids,
    queryTranslation: result.queryTranslation,
  });
}
