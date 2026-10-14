import { getClient } from '../client.js';
import type { GeneInfo, SearchResult, Pathway } from '../types.js';

export async function searchGenes(
  query: string,
  maxResults: number = 20
): Promise<SearchResult<GeneInfo>> {
  const client = getClient();
  return client.searchGenes(query, maxResults);
}

export async function getGeneInfo(geneSymbol: string): Promise<GeneInfo | null> {
  const client = getClient();
  return client.getGeneInfo(geneSymbol);
}

export async function getGenePathways(geneSymbol: string): Promise<Pathway[]> {
  const client = getClient();
  return client.getGenePathways(geneSymbol);
}

export async function getVIPGenes(): Promise<GeneInfo[]> {
  const client = getClient();
  const result = await client.searchGenes('', 100);
  return result.results.filter(gene => gene.hasGuidelines);
}

export async function getGenesWithAnnotations(
  maxResults: number = 50
): Promise<GeneInfo[]> {
  const client = getClient();
  const result = await client.searchGenes('', maxResults);
  return result.results.filter(gene => gene.hasClinicalAnnotations);
}
