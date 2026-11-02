import { getClient } from '../client.js';
import { formatVariationId, formatRsId } from '../utils.js';
import type { VariantInfo, VCVRecord } from '../types.js';

export async function searchVariantsByGene(
  gene: string,
  options?: {
    maxResults?: number;
    clinicalSignificance?: string;
  }
): Promise<{
  gene: string;
  count: number;
  variantIds: string[];
  variants?: VariantInfo[];
}> {
  const client = getClient();
  const result = await client.searchByGene(gene, options);

  const summaries = result.ids.length > 0
    ? await client.getVariantSummaries(result.ids.slice(0, 20))
    : [];

  return {
    gene,
    count: result.count,
    variantIds: result.ids,
    variants: summaries,
  };
}

export async function getVariantInfo(
  variationId: string
): Promise<VariantInfo | null> {
  const client = getClient();
  const formattedId = formatVariationId(variationId);
  const summaries = await client.getVariantSummaries([formattedId]);
  return summaries.length > 0 ? summaries[0] : null;
}

export async function getVCVRecord(
  variationId: string
): Promise<VCVRecord | null> {
  const client = getClient();
  const formattedId = formatVariationId(variationId);
  return client.getVCVRecord(formattedId);
}

export async function lookupByCoordinates(
  chromosome: string,
  start: number,
  stop?: number,
  options?: { maxResults?: number }
): Promise<{
  coordinates: string;
  count: number;
  variantIds: string[];
  variants?: VariantInfo[];
}> {
  const client = getClient();
  const result = await client.searchByCoordinates(chromosome, start, stop, options);

  const coordStr = stop
    ? `chr${chromosome}:${start}-${stop}`
    : `chr${chromosome}:${start}`;

  const summaries = result.ids.length > 0
    ? await client.getVariantSummaries(result.ids.slice(0, 20))
    : [];

  return {
    coordinates: coordStr,
    count: result.count,
    variantIds: result.ids,
    variants: summaries,
  };
}

export async function lookupByRsId(
  rsId: string
): Promise<{
  rsId: string;
  count: number;
  variantIds: string[];
  variants?: VariantInfo[];
}> {
  const client = getClient();
  const formattedRsId = formatRsId(rsId);
  const result = await client.searchByRsId(formattedRsId);

  const summaries = result.ids.length > 0
    ? await client.getVariantSummaries(result.ids)
    : [];

  return {
    rsId: formattedRsId,
    count: result.count,
    variantIds: result.ids,
    variants: summaries,
  };
}

export async function batchVariantLookup(
  variationIds: string[]
): Promise<{
  found: number;
  notFound: string[];
  variants: VariantInfo[];
}> {
  if (variationIds.length === 0) {
    return { found: 0, notFound: [], variants: [] };
  }

  const client = getClient();
  const formattedIds = variationIds.map((id) => {
    try {
      return formatVariationId(id);
    } catch {
      return null;
    }
  });

  const validIds = formattedIds.filter((id): id is string => id !== null);
  const invalidIds = variationIds.filter((_, i) => formattedIds[i] === null);

  const summaries = await client.getVariantSummaries(validIds);

  const foundIds = new Set(summaries.map((s) => s.variationId));
  const notFoundIds = validIds.filter((id) => !foundIds.has(id));

  return {
    found: summaries.length,
    notFound: [...invalidIds, ...notFoundIds],
    variants: summaries,
  };
}

export async function quickVariantSearch(
  query: string,
  maxResults: number = 10
): Promise<{
  query: string;
  totalCount: number;
  variants: Array<{
    name: string;
    gene?: string;
    clinicalSignificance?: string;
    chromosome?: string;
    position?: number;
  }>;
}> {
  const client = getClient();
  const result = await client.quickLookup(query, maxResults);

  return {
    query,
    totalCount: result.totalCount,
    variants: result.variants,
  };
}
