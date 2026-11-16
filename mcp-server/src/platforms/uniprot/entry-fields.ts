import { getClient } from './client.js';
import type { UniProtEntry } from './entry-types.js';

// Short per-tool return-field lists, verified against /configure/uniprotkb/result-fields
// (request-contract.ts and the saved return-fields.json fixture). UniProt rejects a
// whole request when any listed field is unknown, so tools that need every feature, comment or cross-reference type
// (get_protein_features, get_annotation_confidence, get_external_references) fetch
// the full entry instead of enumerating ~230 release-dependent field names; gzip
// keeps the full TP53 entry at about 90 KB on the wire, and they trim locally.
export const ENTRY_FIELDS = {
  info: [
    'accession,id,reviewed,protein_name,gene_names,organism_name,organism_id,length,mass,annotation_score',
    'protein_existence,keyword,cc_function,cc_catalytic_activity,cc_cofactor,cc_pathway,cc_subunit',
    'cc_subcellular_location,cc_tissue_specificity,cc_disease,cc_similarity,cc_domain,xref_pdb,xref_interpro',
    'xref_pfam',
  ].join(','),
  sequence: 'accession,sequence,mass,length',
  structure: 'accession,xref_pdb,ft_turn,ft_helix,ft_strand,cc_subunit',
  domains: 'accession,ft_domain,ft_region,ft_repeat,xref_interpro,xref_pfam,xref_smart',
  variants: 'accession,ft_variant,ft_mutagen,cc_disease,cc_polymorphism',
  composition: 'accession,sequence,mass',
  pathways: 'accession,xref_kegg,xref_reactome,cc_pathway,cc_function',
  interactions: 'accession,xref_string,xref_intact,cc_interaction,cc_subunit',
  compare: 'accession,id,organism_name,length,mass,feature_count',
  homologName: 'accession,protein_name',
  orthologGene: 'accession,gene_primary',
  taxonomy: 'accession,organism_name,organism_id,lineage',
  literature: 'accession,lit_pubmed_id,lit_doi_id',
  validate: 'accession,reviewed',
} as const;
export const INFO_FIELDS = ENTRY_FIELDS.info;

// Verified live: UniProt rejects genbank/embl (the flat file is txt); rdf exceeds
// the app's 1 MB tool-result cap for well-studied entries.
export const EXPORT_FORMATS = ['gff', 'txt', 'xml', 'fasta'];

/** Deep copy without `evidences` keys; the shape is otherwise unchanged. */
export function stripEvidences<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripEvidences) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'evidences')
      .map(([key, child]) => [key, stripEvidences(child)]),
  ) as T;
  return value;
}

/** JSON yields a parsed entry; every other format returns the response body as UniProt sent it. */
export function fetchProtein(accession: string, format: 'json', fields?: string): Promise<UniProtEntry>;
export function fetchProtein(accession: string, format: string, fields?: string): Promise<unknown>;
export async function fetchProtein(accession: string, format: string, fields?: string): Promise<unknown> {
  const response = await getClient().get<unknown>(`/uniprotkb/${encodeURIComponent(accession)}`, {
    params: { format, ...(fields ? { fields } : {}) },
  });
  return response.data;
}

// get_protein_info omits `lineage` (detailed ranks; organism.lineage already has the
// names, get_taxonomy_info has the rest). It is the agent's main overview call. Full PDB cross-references
// (chains, method, resolution per structure) were 60-85% of it for well-studied
// proteins, so keep only the IDs and point to get_protein_structure for details.
export function slimProteinInfo(data: UniProtEntry): UniProtEntry {
  const slim = stripEvidences(data);
  delete slim.references;
  delete slim.sequence?.value;
  const refs = slim.uniProtKBCrossReferences ?? [];
  const pdbIds = refs.filter(ref => ref.database === 'PDB').map(ref => ref.id);
  if (slim.uniProtKBCrossReferences) {
    slim.uniProtKBCrossReferences = refs.filter(ref => ref.database !== 'PDB');
  }
  slim.pdbStructures = { count: pdbIds.length, ids: pdbIds, detailTool: 'get_protein_structure' };
  slim.detailTools = {
    literature: 'get_literature_references', sequence: 'get_protein_sequence',
    features: 'get_protein_features', structures: 'get_protein_structure',
    externalReferences: 'get_external_references', variants: 'get_protein_variants',
  };
  return slim;
}
