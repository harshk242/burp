import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';

export interface EnsemblGene {
  id: string;
  display_name: string;
  description: string;
  biotype: string;
  species: string;
  assembly_name: string;
  seq_region_name: string;
  start: number;
  end: number;
  strand: number;
  source: string;
  version: number;
  logic_name?: string;
  canonical_transcript?: string;
}

export interface EnsemblTranscript {
  id: string;
  parent: string;
  display_name: string;
  biotype: string;
  start: number;
  end: number;
  strand: number;
  is_canonical?: number;
  length: number;
  version: number;
  Translation?: {
    id: string;
    start: number;
    end: number;
    length: number;
  };
  Exon?: EnsemblExon[];
}

export interface EnsemblExon {
  id: string;
  start: number;
  end: number;
  strand: number;
  rank: number;
  phase: number;
  end_phase: number;
  version: number;
}

export interface EnsemblVariant {
  id: string;
  seq_region_name: string;
  start: number;
  end: number;
  strand: number;
  allele_string: string;
  variant_class: string;
  source: string;
  most_severe_consequence: string;
  MAF?: number;
  minor_allele?: string;
  clinical_significance?: string[];
}

export interface EnsemblHomolog {
  id: string;
  protein_id?: string;
  species: string;
  type: string;
  target: {
    id: string;
    protein_id?: string;
    species: string;
    perc_id: number;
    perc_pos: number;
  };
  dn_ds?: number;
  taxonomy_level: string;
}

export interface EnsemblRegulatoryFeature {
  id: string;
  feature_type: string;
  start: number;
  end: number;
  strand: number;
  bound_start: number;
  bound_end: number;
  description: string;
  cell_type?: string[];
  activity?: string;
}

export interface EnsemblSpecies {
  name: string;
  display_name: string;
  taxonomy_id: number;
  assembly: string;
  release: number;
  division: string;
  strain?: string;
  strain_collection?: string;
}

export interface EnsemblXref {
  primary_id: string;
  display_id: string;
  version?: string;
  description?: string;
  dbname: string;
  info_type: string;
  info_text?: string;
  linkage_annotation?: string[];
}

export interface EnsemblSequence {
  id: string;
  desc?: string;
  seq: string;
  molecule: string;
  version?: number;
}

export interface EnsemblAssemblyInfo {
  assembly_name: string;
  assembly_date: string;
  assembly_accession: string;
  genebuild_last_geneset_update: string;
  genebuild_initial_release_date: string;
  genebuild_start_date: string;
  genebuild_version: string;
  genebuild_method: string;
  golden_path_length: number;
  total_coding_sequence_length: number;
  total_genome_length: number;
  coord_system_versions: string[];
  karyotype: string[];
}

export const ENSEMBL_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  backoffMs: [1_000, 3_000],
  jitter: 0.25,
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
  on429: 'wait',
});

export const ENSEMBL_BASE_URL = 'https://rest.ensembl.org';

export interface EnsemblClientOptions {
  /** Retry policy (default ENSEMBL_POLICY). */
  policy?: RetryPolicy;
  /** Transport override (tests). */
  adapter?: AxiosAdapter;
  /** Injectable sleep/clock/random for the retry loop (tests). */
  retryDeps?: RetryDeps;
}

/** An Ensembl REST client with the shared retry attached. */
export function createEnsemblClient(options: EnsemblClientOptions = {}): AxiosInstance {
  const client = axios.create({
    baseURL: ENSEMBL_BASE_URL,
    timeout: 30_000,
    headers: {
      'User-Agent': 'Ensembl-MCP-Server/1.0.0',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(client, options.policy ?? ENSEMBL_POLICY, 'ensembl', options.retryDeps);
}

let apiClient: AxiosInstance | null = null;

export function getClient(): AxiosInstance {
  if (!apiClient) {
    throw new Error('Ensembl API client not initialised. Call init() first.');
  }
  return apiClient;
}

export function init(_env: Record<string, string | undefined>, options: EnsemblClientOptions = {}): void {
  apiClient = createEnsemblClient(options);
}

export function cleanup(): void {
  apiClient = null;
}

export function getDefaultSpecies(species?: string): string {
  return species || 'homo_sapiens';
}

export function formatGenomicRegion(region: string): string {
  if (region.includes(':') && region.includes('-')) {
    return region;
  } else if (region.startsWith('ENS')) {
    return region;
  }
  return region;
}
