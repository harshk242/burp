import { getClient } from '../client.js';
import { formatPmid } from '../utils.js';

export async function findRelatedArticles(
  pmid: string,
  maxResults: number = 20
): Promise<{
  sourceId: string;
  relatedIds: string[];
  count: number;
}> {
  const client = getClient();
  const formattedId = formatPmid(pmid);
  const relatedIds = await client.findRelatedArticles(formattedId);

  const limitedIds = relatedIds.slice(0, maxResults);

  return {
    sourceId: formattedId,
    relatedIds: limitedIds,
    count: relatedIds.length,
  };
}

export async function getCitations(
  pmid: string,
  maxResults: number = 50
): Promise<{
  sourceId: string;
  citingArticles: string[];
  count: number;
}> {
  const client = getClient();
  const formattedId = formatPmid(pmid);
  const citingIds = await client.getCitingArticles(formattedId);

  const limitedIds = citingIds.slice(0, maxResults);

  return {
    sourceId: formattedId,
    citingArticles: limitedIds,
    count: citingIds.length,
  };
}

export async function getReferences(
  pmid: string,
  maxResults: number = 100
): Promise<{
  sourceId: string;
  references: string[];
  count: number;
}> {
  const client = getClient();
  const formattedId = formatPmid(pmid);
  const referenceIds = await client.getReferences(formattedId);

  const limitedIds = referenceIds.slice(0, maxResults);

  return {
    sourceId: formattedId,
    references: limitedIds,
    count: referenceIds.length,
  };
}

export async function getCitationMetrics(
  pmid: string
): Promise<{
  pmid: string;
  citedByCount: number;
  referencesCount: number;
  relatedCount: number;
}> {
  const client = getClient();
  const formattedId = formatPmid(pmid);

  const [citingIds, referenceIds, relatedIds] = await Promise.all([
    client.getCitingArticles(formattedId),
    client.getReferences(formattedId),
    client.findRelatedArticles(formattedId),
  ]);

  return {
    pmid: formattedId,
    citedByCount: citingIds.length,
    referencesCount: referenceIds.length,
    relatedCount: relatedIds.length,
  };
}
