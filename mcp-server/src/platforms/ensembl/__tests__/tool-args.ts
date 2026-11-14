import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';
export const samples: Samples = {
  gene_id: 'ENSG00000141510', gene_ids: ['ENSG00000141510'], species: 'homo_sapiens',
  transcript_id: 'ENST00000269305', query: 'TP53', biotype: 'protein_coding',
  region: '17:7674000-7675000', regions: ['17:7674000-7674100', 'ENST00000269305'],
  sequence: 'ATGTTTTAA', variants: ['rs699'], consequence_type: ['missense_variant'],
  target_species: 'mus_musculus', clusterset_id: 'default', feature_type: 'enhancer',
  external_db: 'HGNC', source_assembly: 'GRCh38', target_assembly: 'GRCh37', division: 'EnsemblVertebrates',
};
export const toolSamples = (tool: Tool): Samples => ["get_regulatory_features", "get_motif_features"].includes(tool.name)
  ? { ...samples, region: "17:7661779-7687550" } : samples;
export const argVariants = (tool: Tool) => variants(tool, toolSamples(tool));
export const clientSide: Record<string, Record<string, string>> = {
  get_transcripts: { canonical_only: 'Filters is_canonical locally; populated fixture tested.' },
  search_genes: { biotype: 'Filters the exact lookup result locally; populated fixture tested.' },
  get_regulatory_features: { feature_type: 'Filters feature description locally; populated fixture tested.' },
  translate_sequence: { sequence: 'Local standard genetic code translation; output tested.' },
};
