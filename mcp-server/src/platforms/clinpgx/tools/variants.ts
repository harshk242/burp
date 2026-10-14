import { getClient } from '../client.js';
import type { VariantInfo, SearchResult, ClinicalAnnotation } from '../types.js';

export async function searchVariants(
  query: string,
  maxResults: number = 20
): Promise<SearchResult<VariantInfo>> {
  const client = getClient();
  return client.searchVariants(query, maxResults);
}

export async function getVariantInfo(variantId: string): Promise<VariantInfo | null> {
  const client = getClient();
  return client.getVariantInfo(variantId);
}

export async function getVariantAnnotations(
  variantId: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();

  const variant = await client.getVariantInfo(variantId);
  if (!variant || !variant.gene) {
    return [];
  }

  const annotations = await client.getClinicalAnnotationsForGene(variant.gene);
  return annotations.filter(annotation =>
    annotation.variant?.toLowerCase().includes(variantId.toLowerCase()) ||
    (variant.rsid && annotation.variant?.includes(variant.rsid))
  );
}

export async function searchVariantsByGene(
  gene: string,
  maxResults: number = 50
): Promise<VariantInfo[]> {
  const client = getClient();
  const result = await client.searchVariants(gene, maxResults);
  return result.results.filter(variant =>
    variant.gene?.toLowerCase() === gene.toLowerCase()
  );
}

export async function getVariantsWithAnnotations(
  gene: string
): Promise<VariantInfo[]> {
  const client = getClient();
  const result = await client.searchVariants(gene, 100);
  return result.results.filter(variant =>
    variant.gene?.toLowerCase() === gene.toLowerCase() &&
    variant.hasClinicalAnnotations
  );
}

export async function getStarAlleles(gene: string): Promise<VariantInfo[]> {
  const client = getClient();
  const result = await client.searchVariants(`${gene}*`, 100);
  return result.results.filter(variant =>
    variant.name?.includes('*') &&
    variant.gene?.toLowerCase() === gene.toLowerCase()
  );
}
