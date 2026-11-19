import type { AxiosAdapter } from 'axios';
import type { RetryDeps } from '../../shared/http-retry.js';
import type { TokenBucketRateLimiter } from '../../shared/rate-limiter.js';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ClinVar may return new or composite terms; preserve their upstream text.
export type ClinicalSignificanceType =
  | (string & {})
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

// ClinVar may return new or composite terms; preserve their upstream text.
export type ReviewStatus =
  | (string & {})
  | 'practice guideline'
  | 'reviewed by expert panel'
  | 'criteria provided, multiple submitters, no conflicts'
  | 'criteria provided, conflicting interpretations'
  | 'criteria provided, single submitter'
  | 'no assertion criteria provided'
  | 'no assertion provided';

// ClinVar may return new or composite terms; preserve their upstream text.
export type VariantType =
  | (string & {})
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

export interface VariantInfo {
  variationId: string;
  name: string;
  variantType?: VariantType;
  gene?: GeneInfo | undefined;
  location?: GenomicLocation;
  hgvs?: HGVSExpressions;
  clinicalSignificance?: ClinicalSignificance;
  reviewStatus?: ReviewStatus;
  lastEvaluated?: string;
  conditions?: Condition[];
  submissionCount?: number;
  rsId?: string | undefined;
}

export interface GeneInfo {
  geneId?: string;
  symbol: string;
  fullName?: string;
  hgncId?: string;
}

export interface GenomicLocation {
  assembly: string;
  chromosome: string;
  start: number;
  stop: number;
  referenceAllele?: string;
  alternateAllele?: string;
  cytogeneticLocation?: string;
}

export interface HGVSExpressions {
  genomic?: string;
  coding?: string;
  protein?: string;
}

export interface ClinicalSignificance {
  description: ClinicalSignificanceType;
  dateLastEvaluated?: string;
  reviewStatus?: ReviewStatus;
  submissionCount?: number;
  conflictingInterpretations?: boolean;
}

export interface Condition {
  name: string;
  medGenId?: string | undefined;
  omimId?: string | undefined;
  orphanetId?: string | undefined;
  trait?: string;
}

export interface VCVRecord {
  accession: string;
  version: number;
  variationId: string;
  name: string;
  variantType?: VariantType;
  gene?: GeneInfo | undefined;
  location?: GenomicLocation | undefined;
  hgvs?: HGVSExpressions;
  clinicalAssertions: ClinicalAssertion[];
  aggregatedClassification?: ClinicalSignificance | undefined;
  functionalConsequence?: string[];
}

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

export interface Submitter {
  submitterId?: string;
  name: string;
  abbreviation?: string;
  orgCategory?: string;
}

export interface SubmissionRecord {
  submissionId: string;
  submitter: Submitter;
  clinicalSignificance: ClinicalSignificance;
  condition: Condition;
  methodType?: string | undefined;
  collectionMethod?: string;
  alleleOrigin?: string;
  dateSubmitted?: string | undefined;
  dateLastUpdated?: string | undefined;
  citations?: string[];
  comment?: string;
}

export interface ClinicalTablesResult {
  totalCount: number;
  variants: ClinicalTablesVariant[];
}

export interface ClinicalTablesVariant {
  name: string;
  gene?: string | undefined;
  clinicalSignificance?: string | undefined;
  reviewStatus?: string | undefined;
  chromosome?: string | undefined;
  position?: number | undefined;
  rsId?: string | undefined;
}

export interface VariantFrequencyResult {
  variationId: string;
  hasFrequencyData: boolean;
  frequencies: PopulationFrequency[];
}

export interface PopulationFrequency {
  minorAllele?: string;
  measureId?: string;
  source: string;
  population?: string;
  alleleFrequency?: number;
  homozygoteCount?: number;
  alleleCount?: number;
  alleleNumber?: number;
}

export interface ClinVarClientOptions {
  apiKey?: string | undefined;
  cacheTtl?: number;
  maxAttempts?: number;
  retryDelay?: number;
  rateLimiter?: TokenBucketRateLimiter;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}
