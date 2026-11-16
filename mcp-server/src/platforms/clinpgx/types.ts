import type { AxiosAdapter } from 'axios';
import type { RetryDeps } from '../../shared/http-retry.js';

export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export interface GeneInfo {
  id: string;
  symbol: string;
  name?: string | undefined;
  alternateSymbols?: string[];
  chromosomeLocation?: string | undefined;
  pharmgkbAccessionId?: string | undefined;
  hasVariants?: boolean | undefined;
  hasGuidelines?: boolean | undefined;
  hasClinicalAnnotations?: boolean | undefined;
  crossReferences?: CrossReference[];
  summary?: string | undefined;
}

export interface DrugInfo {
  id: string;
  name: string;
  genericNames?: string[];
  brandNames?: string[];
  drugClass?: string | undefined;
  atcCodes?: string[];
  pharmgkbAccessionId?: string | undefined;
  hasGuidelines?: boolean | undefined;
  hasClinicalAnnotations?: boolean | undefined;
  hasLabels?: boolean | undefined;
  crossReferences?: CrossReference[];
  summary?: string | undefined;
}

export interface VariantInfo {
  id: string;
  name?: string | undefined;
  rsid?: string | undefined;
  gene?: string | undefined;
  variantType?: string | undefined;
  location?: string | undefined;
  hasClinicalAnnotations?: boolean | undefined;
  hasGuidelines?: boolean | undefined;
  crossReferences?: CrossReference[];
}

export interface ClinicalAnnotation {
  id: string;
  gene: string;
  drug: string;
  variant?: string | undefined;
  phenotypeCategory?: string;
  levelOfEvidence?: string;
  annotation?: string | undefined;
  alleles?: string[];
  phenotypes?: string[];
  populations?: string[];
  relatedChemicals?: string[];
  relatedGenes?: string[];
  pmids?: string[];
}

export interface DosingGuideline {
  id: string;
  name: string;
  source: 'CPIC' | 'DPWG' | 'Other';
  genes: string[];
  drugs: string[];
  recommendation?: string | undefined;
  hasRecommendation?: boolean | undefined;
  implications?: string | undefined;
  phenotypeCategory?: string | undefined;
  alternateDrug?: string | undefined;
  url?: string;
  version?: string | undefined;
  lastModified?: string | undefined;
}

export interface DrugLabel {
  id: string;
  name: string;
  drug: string;
  source: string;
  agency?: string | undefined;
  approvalDate?: string | undefined;
  biomarkerCategory?: string | undefined;
  genes?: string[];
  variants?: string[];
  labelText?: string | undefined;
  url?: string | undefined;
}

export interface Pathway {
  id: string;
  name: string;
  type?: string | undefined;
  description?: string | undefined;
  genes?: string[];
  drugs?: string[];
  url?: string;
}

export interface LiteratureReference {
  pmid: string;
  title?: string;
  authors?: string[];
  journal?: string;
  year?: number;
  doi?: string;
}

export interface CrossReference {
  database: string;
  id: string;
  url?: string | undefined;
}

export interface DrugGeneInteraction {
  drug: string;
  gene: string;
  interactionType?: string;
  phenotypeCategory?: string | undefined;
  hasGuideline?: boolean;
  hasClinicalAnnotation?: boolean;
  evidenceLevel?: string | undefined;
}

export interface VIPAnnotation {
  gene: string;
  summary: string;
  keyVariants?: string[];
  keyDrugs?: string[];
  clinicalRelevance?: string;
}

export interface AlleleFunctionality {
  allele: string;
  gene: string;
  functionality?: string;
  activityScore?: number;
  clinicalFunction?: string;
  haplotype?: string;
}

export interface DiplotypePhenotype {
  gene: string;
  diplotype: string;
  phenotype: string;
  activityScore?: number;
  ehRRecommendation?: string;
}

export interface SearchResult<T> {
  totalCount: number;
  results: T[];
  query: string;
}

export interface PharmGKBClientOptions {
  cacheTtl?: number;
  maxAttempts?: number;
  retryDelay?: number;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}
