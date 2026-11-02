import { getClient } from '../client.js';
import { formatPmid, formatCitation as formatCitationUtil } from '../utils.js';
import type { MeshTerm, PubMedArticle } from '../types.js';

export async function getMeshTerms(
  pmid: string
): Promise<{
  pmid: string;
  meshTerms: MeshTerm[];
  majorTopics: string[];
}> {
  const client = getClient();
  const formattedId = formatPmid(pmid);
  const articles = await client.fetchArticles(formattedId);

  if (articles.length === 0) {
    return {
      pmid: formattedId,
      meshTerms: [],
      majorTopics: [],
    };
  }

  const article = articles[0];
  const meshTerms = article.meshTerms || [];
  const majorTopics = meshTerms
    .filter((m) => m.majorTopic)
    .map((m) => m.descriptorName);

  return {
    pmid: formattedId,
    meshTerms,
    majorTopics,
  };
}

export async function getPublicationTrends(
  query: string,
  startYear: number,
  endYear?: number
): Promise<{
  query: string;
  years: Array<{ year: number; count: number }>;
  totalCount: number;
  averagePerYear: number;
}> {
  const client = getClient();
  const currentYear = endYear || new Date().getFullYear();
  const years: Array<{ year: number; count: number }> = [];
  let totalCount = 0;

  for (let year = startYear; year <= currentYear; year++) {
    const yearQuery = `${query} AND "${year}"[Date - Publication]`;
    const result = await client.search(yearQuery, { maxResults: 0 });
    years.push({ year, count: result.count });
    totalCount += result.count;
  }

  const numYears = currentYear - startYear + 1;
  const averagePerYear = Math.round(totalCount / numYears);

  return {
    query,
    years,
    totalCount,
    averagePerYear,
  };
}

export async function formatCitation(
  pmid: string,
  style: 'apa' | 'mla' | 'vancouver' | 'bibtex' = 'vancouver'
): Promise<{
  pmid: string;
  citation: string;
  style: string;
}> {
  const client = getClient();
  const formattedId = formatPmid(pmid);
  const articles = await client.fetchArticles(formattedId);

  if (articles.length === 0) {
    return {
      pmid: formattedId,
      citation: `Article not found: PMID ${formattedId}`,
      style,
    };
  }

  const article = articles[0];
  const citation = formatCitationUtil(
    {
      authors: article.authors,
      title: article.title,
      journal: article.journal,
      pubDate: article.pubDate,
      pmid: article.pmid,
      doi: article.doi,
    },
    style
  );

  return {
    pmid: formattedId,
    citation,
    style,
  };
}

export async function compareArticles(
  pmids: string[]
): Promise<{
  articles: Array<{
    pmid: string;
    title: string;
    year: string;
    journal: string;
    authors: number;
    hasMesh: boolean;
    hasAbstract: boolean;
  }>;
}> {
  const client = getClient();
  const articles = await client.fetchArticles(pmids);

  return {
    articles: articles.map((a) => ({
      pmid: a.pmid,
      title: a.title,
      year: a.pubDate?.substring(0, 4) || 'Unknown',
      journal: a.journal.title || 'Unknown',
      authors: a.authors.length,
      hasMesh: (a.meshTerms?.length || 0) > 0,
      hasAbstract: !!a.abstract,
    })),
  };
}

export async function extractKeyTerms(
  pmids: string[]
): Promise<{
  meshTermFrequency: Array<{ term: string; count: number }>;
  keywordFrequency: Array<{ keyword: string; count: number }>;
  publicationTypes: Array<{ type: string; count: number }>;
}> {
  const client = getClient();
  const articles = await client.fetchArticles(pmids);

  const meshCounts: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};
  const pubTypeCounts: Record<string, number> = {};

  for (const article of articles) {
    for (const mesh of article.meshTerms || []) {
      const term = mesh.descriptorName;
      meshCounts[term] = (meshCounts[term] || 0) + 1;
    }

    for (const kw of article.keywords || []) {
      keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
    }

    for (const pt of article.publicationTypes || []) {
      pubTypeCounts[pt] = (pubTypeCounts[pt] || 0) + 1;
    }
  }

  const meshTermFrequency = Object.entries(meshCounts)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const keywordFrequency = Object.entries(keywordCounts)
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const publicationTypes = Object.entries(pubTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    meshTermFrequency,
    keywordFrequency,
    publicationTypes,
  };
}
