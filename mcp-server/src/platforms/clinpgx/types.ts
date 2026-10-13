// TypeScript interfaces for ClinPGx/PharmGKB platform module

import type { AxiosAdapter } from 'axios';
import type { RetryDeps } from '../../shared/http-retry.js';

// Cache entry type
export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

// Gene information
export interface GeneInfo {
  id: string;
  symbol: string;
  name?: string;
  alternateSymbols?: string[];
  chromosomeLocation?: string;
  pharmgkbAccessionId?: string;
  hasVariants?: boolean;
  hasGuidelines?: boolean;
  hasClinicalAnnotations?: boolean;
  crossReferences?: CrossReference[];
  summary?: string;
}

// Drug information
export interface DrugInfo {
  id: string;
  name: string;
  genericNames?: string[];
  brandNames?: string[];
  drugClass?: string;
  atcCodes?: string[];
  pharmgkbAccessionId?: string;
  hasGuidelines?: boolean;
  hasClinicalAnnotations?: boolean;
  hasLabels?: boolean;
  crossReferences?: CrossReference[];
  summary?: string;
}

// Variant information
export interface VariantInfo {
  id: string;
  name?: string;
  rsid?: string;
  gene?: string;
  variantType?: string;
  location?: string;
  hasClinicalAnnotations?: boolean;
  hasGuidelines?: boolean;
  crossReferences?: CrossReference[];
}

// Clinical annotation
export interface ClinicalAnnotation {
  id: string;
  gene: string;
  drug: string;
  variant?: string;
  phenotypeCategory?: string;
  levelOfEvidence?: string;
  annotation?: string;
  alleles?: string[];
  phenotypes?: string[];
  populations?: string[];
  relatedChemicals?: string[];
  relatedGenes?: string[];
  pmids?: string[];
}

// Dosing guideline
export interface DosingGuideline {
  id: string;
  name: string;
  source: 'CPIC' | 'DPWG' | 'Other';
  genes: string[];
  drugs: string[];
  recommendation?: string;
  implications?: string;
  phenotypeCategory?: string;
  alternateDrug?: string;
  url?: string;
  version?: string;
  lastModified?: string;
}

// Drug label
export interface DrugLabel {
  id: string;
  name: string;
  drug: string;
  source: string;
  agency?: string;
  approvalDate?: string;
  biomarkerCategory?: string;
  genes?: string[];
  variants?: string[];
  labelText?: string;
  url?: string;
}

// Pathway information
export interface Pathway {
  id: string;
  name: string;
  type?: string;
  description?: string;
  genes?: string[];
  drugs?: string[];
  url?: string;
}

// Literature reference
export interface LiteratureReference {
  pmid: string;
  title?: string;
  authors?: string[];
  journal?: string;
  year?: number;
  doi?: string;
}

// Cross reference
export interface CrossReference {
  database: string;
  id: string;
  url?: string;
}

// Drug-gene interaction
export interface DrugGeneInteraction {
  drug: string;
  gene: string;
  interactionType?: string;
  phenotypeCategory?: string;
  hasGuideline?: boolean;
  hasClinicalAnnotation?: boolean;
  evidenceLevel?: string;
}

// VIP (Very Important Pharmacogene) annotation
export interface VIPAnnotation {
  gene: string;
  summary: string;
  keyVariants?: string[];
  keyDrugs?: string[];
  clinicalRelevance?: string;
}

// Allele functionality
export interface AlleleFunctionality {
  allele: string;
  gene: string;
  functionality?: string;
  activityScore?: number;
  clinicalFunction?: string;
  haplotype?: string;
}

// Diplotype-phenotype mapping
export interface DiplotypePhenotype {
  gene: string;
  diplotype: string;
  phenotype: string;
  activityScore?: number;
  ehRRecommendation?: string;
}

// Search result
export interface SearchResult<T> {
  totalCount: number;
  results: T[];
  query: string;
}

// Client options
export interface PharmGKBClientOptions {
  cacheTtl?: number;
  /** Total attempts per request (default 3). */
  maxRetries?: number;
  /** Backoff base: waits of `2^n × retryDelay` ms (default 1000). */
  retryDelay?: number;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}
