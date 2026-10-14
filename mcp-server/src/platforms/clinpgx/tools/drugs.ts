import { getClient } from '../client.js';
import type { DrugInfo, SearchResult, DrugLabel } from '../types.js';

export async function searchDrugs(
  query: string,
  maxResults: number = 20
): Promise<SearchResult<DrugInfo>> {
  const client = getClient();
  return client.searchDrugs(query, maxResults);
}

export async function getDrugInfo(drugName: string): Promise<DrugInfo | null> {
  const client = getClient();
  return client.getDrugInfo(drugName);
}

export async function getDrugLabels(drugName: string): Promise<DrugLabel[]> {
  const client = getClient();
  return client.getDrugLabels(drugName);
}

export async function getDrugsWithGuidelines(
  maxResults: number = 50
): Promise<DrugInfo[]> {
  const client = getClient();
  const result = await client.searchDrugs('', maxResults);
  return result.results.filter(drug => drug.hasGuidelines);
}

export async function getDrugsWithAnnotations(
  maxResults: number = 50
): Promise<DrugInfo[]> {
  const client = getClient();
  const result = await client.searchDrugs('', maxResults);
  return result.results.filter(drug => drug.hasClinicalAnnotations);
}
