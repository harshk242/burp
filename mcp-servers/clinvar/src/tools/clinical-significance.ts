// Clinical significance tools for ClinVar MCP Server

import { getClient } from '../client.js';
import { parseSubmissions } from '../xml-parser.js';
import type { VariantInfo, SubmissionRecord, ClinicalSignificance } from '../types.js';

/**
 * Get clinical significance for a variant
 */
export async function getClinicalSignificance(
  variationId: string
): Promise<{
  variationId: string;
  clinicalSignificance: ClinicalSignificance | null;
  reviewStatus: string | null;
  submissionCount: number;
  conflictingInterpretations: boolean;
  submissions?: Array<{
    submitter: string;
    interpretation: string;
    dateSubmitted?: string;
  }>;
}> {
  const client = getClient();
  const vcvRecord = await client.getVCVRecord(variationId);

  if (!vcvRecord) {
    return {
      variationId,
      clinicalSignificance: null,
      reviewStatus: null,
      submissionCount: 0,
      conflictingInterpretations: false,
    };
  }

  const submissions = vcvRecord.clinicalAssertions.map((assertion) => ({
    submitter: assertion.submitter.name,
    interpretation: assertion.clinicalSignificance.description,
    dateSubmitted: assertion.dateSubmitted,
  }));

  // Check for conflicting interpretations
  const interpretations = new Set(submissions.map((s) => s.interpretation));
  const pathogenicTerms = ['Pathogenic', 'Likely pathogenic'];
  const benignTerms = ['Benign', 'Likely benign'];
  const hasPathogenic = [...interpretations].some((i) => pathogenicTerms.includes(i));
  const hasBenign = [...interpretations].some((i) => benignTerms.includes(i));
  const conflictingInterpretations = hasPathogenic && hasBenign;

  return {
    variationId: vcvRecord.variationId,
    clinicalSignificance: vcvRecord.aggregatedClassification || null,
    reviewStatus: vcvRecord.aggregatedClassification?.reviewStatus || null,
    submissionCount: submissions.length,
    conflictingInterpretations,
    submissions,
  };
}

/**
 * Search variants by condition/disease
 */
export async function searchByCondition(
  condition: string,
  options?: {
    maxResults?: number;
    clinicalSignificance?: string;
  }
): Promise<{
  condition: string;
  count: number;
  variantIds: string[];
  variants?: VariantInfo[];
}> {
  const client = getClient();
  const result = await client.searchByCondition(condition, options);

  const summaries = result.ids.length > 0
    ? await client.getVariantSummaries(result.ids.slice(0, 20))
    : [];

  return {
    condition,
    count: result.count,
    variantIds: result.ids,
    variants: summaries,
  };
}

/**
 * Search variants by molecular consequence
 */
export async function searchByMolecularConsequence(
  consequence: string,
  options?: {
    gene?: string;
    maxResults?: number;
  }
): Promise<{
  consequence: string;
  gene?: string;
  count: number;
  variantIds: string[];
  variants?: VariantInfo[];
}> {
  const client = getClient();
  const result = await client.searchByMolecularConsequence(consequence, options);

  const summaries = result.ids.length > 0
    ? await client.getVariantSummaries(result.ids.slice(0, 20))
    : [];

  return {
    consequence,
    gene: options?.gene,
    count: result.count,
    variantIds: result.ids,
    variants: summaries,
  };
}

/**
 * Search by review status
 */
export async function searchByReviewStatus(
  reviewStatus: string,
  options?: {
    gene?: string;
    clinicalSignificance?: string;
    maxResults?: number;
  }
): Promise<{
  reviewStatus: string;
  count: number;
  variantIds: string[];
  variants?: VariantInfo[];
}> {
  const client = getClient();
  const result = await client.searchByReviewStatus(reviewStatus, options);

  const summaries = result.ids.length > 0
    ? await client.getVariantSummaries(result.ids.slice(0, 20))
    : [];

  return {
    reviewStatus,
    count: result.count,
    variantIds: result.ids,
    variants: summaries,
  };
}

/**
 * Get variant submissions
 */
export async function getVariantSubmissions(
  variationId: string
): Promise<{
  variationId: string;
  submissionCount: number;
  submissions: SubmissionRecord[];
}> {
  const client = getClient();
  const vcvRecord = await client.getVCVRecord(variationId);

  if (!vcvRecord) {
    return {
      variationId,
      submissionCount: 0,
      submissions: [],
    };
  }

  const submissions = parseSubmissions(vcvRecord);

  return {
    variationId: vcvRecord.variationId,
    submissionCount: submissions.length,
    submissions,
  };
}

/**
 * Get variant frequency data
 */
export async function getVariantFrequency(
  variationId: string
): Promise<{
  variationId: string;
  hasFrequencyData: boolean;
  frequencies?: Array<{
    source: string;
    population?: string;
    alleleFrequency?: number;
  }>;
}> {
  const client = getClient();
  const vcvRecord = await client.getVCVRecord(variationId);

  if (!vcvRecord || !vcvRecord.location) {
    return {
      variationId,
      hasFrequencyData: false,
    };
  }

  // Note: Full frequency data requires querying gnomAD or other sources
  // ClinVar provides limited frequency info directly
  return {
    variationId: vcvRecord.variationId,
    hasFrequencyData: false,
    frequencies: [],
  };
}

/**
 * Get pathogenic variants for a gene
 */
export async function getPathogenicVariantsForGene(
  gene: string,
  maxResults: number = 50
): Promise<{
  gene: string;
  count: number;
  variants: VariantInfo[];
}> {
  const client = getClient();
  const result = await client.searchByGene(gene, {
    maxResults,
    clinicalSignificance: 'pathogenic',
  });

  const summaries = result.ids.length > 0
    ? await client.getVariantSummaries(result.ids.slice(0, maxResults))
    : [];

  return {
    gene,
    count: result.count,
    variants: summaries,
  };
}
