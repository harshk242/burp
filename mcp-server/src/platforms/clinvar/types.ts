// TypeScript interfaces for ClinVar platform module

import type { AxiosAdapter } from 'axios';
import type { RetryDeps } from '../../shared/http-retry.js';
import type { TokenBucketRateLimiter } from '../../shared/rate-limiter.js';

// Cache entry type
export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

// Clinical significance classification
export type ClinicalSignificanceType =
  | 'Pathogenic'
  | 'Likely pathogenic'
  | 'Uncertain significance'
  | 'Likely benign'
  | 'Benign'
  | 'Conflicting interpretations of pathogenicity'
  | 'drug response'
  | 'risk factor'
  | 'protective'
  | 'association'
  | 'affects'
  | 'not provided'
  | 'other';

// Review status
export type ReviewStatus =
  | 'practice guideline'
  | 'reviewed by expert panel'
  | 'criteria provided, multiple submitters, no conflicts'
  | 'criteria provided, conflicting interpretations'
  | 'criteria provided, single submitter'
  | 'no assertion criteria provided'
  | 'no assertion provided';

// Variant types
export type VariantType =
  | 'single nucleotide variant'
  | 'Deletion'
  | 'Insertion'
  | 'Duplication'
  | 'Indel'
  | 'copy number gain'
  | 'copy number loss'
  | 'Inversion'
  | 'Translocation'
  | 'Complex'
  | 'other';

// Molecular consequence
export type MolecularConsequence =
  | 'missense variant'
  | 'nonsense'
  | 'frameshift variant'
  | 'splice site variant'
  | 'synonymous variant'
  | 'intron variant'
  | 'regulatory region variant'
  | '3 prime UTR variant'
  | '5 prime UTR variant'
  | 'start lost'
  | 'stop lost'
  | 'inframe insertion'
  | 'inframe deletion'
  | 'other';

// Basic variant info
export interface VariantInfo {
  variationId: string;
  name: string;
  variantType?: VariantType;
  gene?: GeneInfo;
  location?: GenomicLocation;
  hgvs?: HGVSExpressions;
  clinicalSignificance?: ClinicalSignificance;
  reviewStatus?: ReviewStatus;
  lastEvaluated?: string;
  conditions?: Condition[];
  submissionCount?: number;
  rsId?: string;
}

// Gene information
export interface GeneInfo {
  geneId?: string;
  symbol: string;
  fullName?: string;
  hgncId?: string;
}

// Genomic location
export interface GenomicLocation {
  assembly: string;
  chromosome: string;
  start: number;
  stop: number;
  referenceAllele?: string;
  alternateAllele?: string;
  cytogeneticLocation?: string;
}

// HGVS expressions
export interface HGVSExpressions {
  genomic?: string;
  coding?: string;
  protein?: string;
}

// Clinical significance
export interface ClinicalSignificance {
  description: ClinicalSignificanceType;
  dateLastEvaluated?: string;
  reviewStatus?: ReviewStatus;
  submissionCount?: number;
  conflictingInterpretations?: boolean;
}

// Condition/disease
export interface Condition {
  name: string;
  medGenId?: string;
  omimId?: string;
  orphanetId?: string;
  trait?: string;
}

// VCV (Variation) Record
export interface VCVRecord {
  accession: string;
  version: number;
  variationId: string;
  name: string;
  variantType?: VariantType;
  gene?: GeneInfo;
  location?: GenomicLocation;
  hgvs?: HGVSExpressions;
  clinicalAssertions: ClinicalAssertion[];
  aggregatedClassification?: ClinicalSignificance;
  functionalConsequence?: string[];
}

// RCV (Reference) Record
export interface RCVRecord {
  accession: string;
  version: number;
  variationId: string;
  clinicalSignificance: ClinicalSignificance;
  condition: Condition;
  submitter: Submitter;
  dateCreated?: string;
  dateLastUpdated?: string;
}

// Clinical assertion
export interface ClinicalAssertion {
  id: string;
  clinicalSignificance: ClinicalSignificance;
  condition: Condition;
  submitter: Submitter;
  methodType?: string;
  citedEvidence?: string[];
  dateSubmitted?: string;
  dateLastUpdated?: string;
}

// Submitter information
export interface Submitter {
  submitterId?: string;
  name: string;
  abbreviation?: string;
  orgCategory?: string;
}

// Submission record
export interface SubmissionRecord {
  submissionId: string;
  submitter: Submitter;
  clinicalSignificance: ClinicalSignificance;
  condition: Condition;
  methodType?: string;
  collectionMethod?: string;
  alleleOrigin?: string;
  dateSubmitted?: string;
  dateLastUpdated?: string;
  citations?: string[];
  comment?: string;
}

// Search result from Clinical Tables API
export interface ClinicalTablesResult {
  totalCount: number;
  variants: ClinicalTablesVariant[];
}

export interface ClinicalTablesVariant {
  name: string;
  gene?: string;
  clinicalSignificance?: string;
  reviewStatus?: string;
  chromosome?: string;
  position?: number;
  rsId?: string;
}

// Population frequency data
export interface PopulationFrequency {
  source: string;
  population?: string;
  alleleFrequency?: number;
  homozygoteCount?: number;
  alleleCount?: number;
  alleleNumber?: number;
}

// Client options
export interface ClinVarClientOptions {
  apiKey?: string;
  cacheTtl?: number;
  /** Total attempts per NCBI request (default 3); Clinical Tables always makes 1. */
  maxRetries?: number;
  /** NCBI backoff base: waits of `2^n × retryDelay` ms (default 1000). */
  retryDelay?: number;
  /** NCBI token bucket (default: from the API key). */
  rateLimiter?: TokenBucketRateLimiter;
  /** Transport override for both instances (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}
