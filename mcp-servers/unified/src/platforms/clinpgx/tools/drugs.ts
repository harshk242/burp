// Drug-related tool implementations for ClinPGx platform module

import { getClient } from '../client.js';
import type { DrugInfo, SearchResult, DrugLabel } from '../types.js';

/**
 * Search for drugs by name
 */
export async function searchDrugs(
  query: string,
  maxResults: number = 20
): Promise<SearchResult<DrugInfo>> {
  const client = getClient();
  return client.searchDrugs(query, maxResults);
}

/**
 * Get detailed information about a specific drug
 */
export async function getDrugInfo(drugName: string): Promise<DrugInfo | null> {
  const client = getClient();
  return client.getDrugInfo(drugName);
}

/**
 * Get FDA/EMA drug labels for a drug
 */
export async function getDrugLabels(drugName: string): Promise<DrugLabel[]> {
  const client = getClient();
  return client.getDrugLabels(drugName);
}

/**
 * Get drugs with pharmacogenomic guidelines
 */
export async function getDrugsWithGuidelines(
  maxResults: number = 50
): Promise<DrugInfo[]> {
  const client = getClient();
  const result = await client.searchDrugs('', maxResults);
  return result.results.filter(drug => drug.hasGuidelines);
}

/**
 * Get drugs with clinical annotations
 */
export async function getDrugsWithAnnotations(
  maxResults: number = 50
): Promise<DrugInfo[]> {
  const client = getClient();
  const result = await client.searchDrugs('', maxResults);
  return result.results.filter(drug => drug.hasClinicalAnnotations);
}
