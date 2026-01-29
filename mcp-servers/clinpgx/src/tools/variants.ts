// Variant-related tool implementations for ClinPGx MCP Server

import { getClient } from '../client.js';
import type { VariantInfo, SearchResult, ClinicalAnnotation } from '../types.js';

/**
 * Search for pharmacogenomic variants
 */
export async function searchVariants(
  query: string,
  maxResults: number = 20
): Promise<SearchResult<VariantInfo>> {
  const client = getClient();
  return client.searchVariants(query, maxResults);
}

/**
 * Get variant information by ID or rsID
 */
export async function getVariantInfo(variantId: string): Promise<VariantInfo | null> {
  const client = getClient();
  return client.getVariantInfo(variantId);
}

/**
 * Get clinical annotations for a specific variant
 */
export async function getVariantAnnotations(
  variantId: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();

  // First get variant info to get the gene
  const variant = await client.getVariantInfo(variantId);
  if (!variant || !variant.gene) {
    return [];
  }

  // Get annotations for the gene and filter by variant
  const annotations = await client.getClinicalAnnotationsForGene(variant.gene);
  return annotations.filter(annotation =>
    annotation.variant?.toLowerCase().includes(variantId.toLowerCase()) ||
    (variant.rsid && annotation.variant?.includes(variant.rsid))
  );
}

/**
 * Search variants by gene
 */
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

/**
 * Get variants with clinical annotations
 */
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

/**
 * Get star alleles for a gene (CYP genes typically)
 */
export async function getStarAlleles(gene: string): Promise<VariantInfo[]> {
  const client = getClient();
  const result = await client.searchVariants(`${gene}*`, 100);
  return result.results.filter(variant =>
    variant.name?.includes('*') &&
    variant.gene?.toLowerCase() === gene.toLowerCase()
  );
}
