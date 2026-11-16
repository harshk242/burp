import { SEARCH_SIZE_SCHEMA, REVIEWED_SCHEMA } from '../search-fields.js';
import { EXPORT_FORMATS } from '../entry-fields.js';

const ORGANISM_DESCRIPTION = 'Organism: NCBI taxonomy ID (e.g., 9606), common name (human, mouse) or scientific name';
const TARGET_ORGANISM_DESCRIPTION = 'Target organism: NCBI taxonomy ID (e.g., 10090), common name (mouse) or scientific name';
const SUMMARY_NOTE = 'Returns compact summaries with totalResults (all matching hits); use get_protein_info or other entry tools for details. Reviewed entries by default; an empty reviewed search includes a hint to retry with reviewed: false.';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  {
    name: 'search_proteins',
    description: `Search UniProt database for proteins by name, keyword, or organism. JSON, TSV or XML (summary XML schema), or sequences in FASTA. ${SUMMARY_NOTE} A reviewed: term inside query overrides the reviewed argument.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (protein name, keyword, or UniProt query syntax). If it contains a reviewed: term, the default reviewed filter is not added.' },
        organism: { type: 'string', description: ORGANISM_DESCRIPTION },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
        format: { type: 'string', enum: ['json', 'tsv', 'fasta', 'xml'], description: 'Output format (default: json). XML contains summaries; FASTA returns at most 10 sequences.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_by_gene',
    description:
      `Search for proteins by gene name or symbol. Defaults to human (Homo sapiens) if no species specified. ${SUMMARY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        gene: { type: 'string', description: 'Gene name or symbol (e.g., BRCA1, INS)' },
        species: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Species to search. Accepts common names (human, mouse, rat), scientific names, or taxon IDs. Defaults to ["human"] if omitted.',
        },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
      },
      required: ['gene'],
    },
  },
  {
    name: 'search_by_function',
    description: `Search proteins by GO terms or functional annotations. ${SUMMARY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        goTerm: { type: 'string', description: 'Gene Ontology term (e.g., GO:0005524)' },
        function: { type: 'string', description: 'Functional description or keyword' },
        organism: { type: 'string', description: ORGANISM_DESCRIPTION },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
      },
      required: [],
    },
  },
  {
    name: 'search_by_localization',
    description: `Find proteins by subcellular localization. ${SUMMARY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        localization: { type: 'string', description: 'Subcellular localization (e.g., nucleus, mitochondria)' },
        organism: { type: 'string', description: ORGANISM_DESCRIPTION },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
      },
      required: ['localization'],
    },
  },
  {
    name: 'search_by_taxonomy',
    description: `Search by detailed taxonomic classification. ${SUMMARY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        taxonomyId: { type: 'number', description: 'NCBI taxonomy ID', minimum: 1 },
        taxonomyName: { type: 'string', description: 'Taxonomic name (e.g., Mammalia, Bacteria)' },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
      },
      required: [],
    },
  },
  {
    name: 'advanced_search',
    description: `Complex queries with multiple filters (length, mass, organism, function). ${SUMMARY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Base search query (UniProt query syntax). If it contains a reviewed: term, the default reviewed filter is not added.' },
        organism: { type: 'string', description: ORGANISM_DESCRIPTION },
        minLength: { type: 'number', description: 'Minimum sequence length', minimum: 1 },
        maxLength: { type: 'number', description: 'Maximum sequence length' },
        minMass: { type: 'number', description: 'Minimum molecular mass (Da)', minimum: 1 },
        maxMass: { type: 'number', description: 'Maximum molecular mass (Da)' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Array of keywords to include' },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
      },
      required: [],
    },
  },

  {
    name: 'get_protein_info',
    description: 'Get curated protein details without evidence arrays, literature citations or raw sequence. PDB structures are summarised as pdbStructures {count, ids}; use get_protein_structure for chains, method and resolution. Use get_literature_references, get_protein_features and get_protein_sequence for the other details. XML uses the same slim protein schema.',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number (e.g., P04637)' },
        format: { type: 'string', enum: ['json', 'tsv', 'fasta', 'xml'], description: 'Output format (default: json)' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_sequence',
    description: 'Get the amino acid sequence for a protein',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
        format: { type: 'string', enum: ['fasta', 'json'], description: 'Output format (default: fasta)' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_features',
    description: 'All sequence features, comments (including web resources) and keywords for a protein, without evidence arrays',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_structure',
    description: 'Retrieve 3D structure information from PDB references',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_domains_detailed',
    description: 'Enhanced domain analysis with InterPro, Pfam, and SMART annotations',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_variants',
    description: 'All natural variants and mutagenesis, without evidence arrays, with counts. naturalVariants carry UniProt\'s stated clinicalSignificance when present. diseaseVariants are variants whose description names a DISEASE comment acronym of this entry, excluding negated mentions and variants UniProt states as benign, likely benign or uncertain significance (counted in excludedDiseaseMentionCount). UniProt curation, not a clinical pathogenicity classification.',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'analyze_sequence_composition',
    description: 'Amino acid composition, hydrophobicity, and other sequence properties',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_pathways',
    description: 'Associated biological pathways (KEGG, Reactome)',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_interactions',
    description: 'Protein-protein interaction networks',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },

  {
    name: 'compare_proteins',
    description: 'Compare multiple proteins side-by-side with sequence and feature comparison',
    inputSchema: {
      type: 'object',
      properties: {
        accessions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of UniProt accession numbers (2-10)',
          minItems: 2,
          maxItems: 10,
        },
        format: { type: 'string', enum: ['json', 'tsv'], description: 'Output format (default: json)' },
      },
      required: ['accessions'],
    },
  },
  {
    name: 'get_protein_homologs',
    description: `Find homologous proteins across different species. ${SUMMARY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
        organism: { type: 'string', description: TARGET_ORGANISM_DESCRIPTION },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_orthologs',
    description: `Identify orthologous proteins for evolutionary studies. ${SUMMARY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
        organism: { type: 'string', description: TARGET_ORGANISM_DESCRIPTION },
        size: SEARCH_SIZE_SCHEMA,
        reviewed: REVIEWED_SCHEMA,
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_phylogenetic_info',
    description: 'Retrieve evolutionary relationships and phylogenetic data',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },

  {
    name: 'batch_protein_lookup',
    description: 'Compact per-entry summaries for up to 25 accessions (case-insensitive; isoforms such as P04637-2 supported). JSON reports each accession individually: invalid format, not found, or inactive (merged accessions resolve to the current entry with mergedInto; demerged/deleted ones list replacedBy). TSV summaries or FASTA sequences also supported (FASTA up to 10 accessions); these fail if any accession is malformed.',
    inputSchema: {
      type: 'object',
      properties: {
        accessions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of UniProt accession numbers (1-25)',
          minItems: 1,
          maxItems: 25,
        },
        format: { type: 'string', enum: ['json', 'tsv', 'fasta'], description: 'Output format (default: json)' },
      },
      required: ['accessions'],
    },
  },
  {
    name: 'get_external_references',
    description: 'External references grouped by database (including PDB, EMBL, RefSeq, Ensembl and GO), with per-database counts and no duplicated arrays.',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_literature_references',
    description: 'Associated publications and citations',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_annotation_confidence',
    description: 'Quality scores, reference count and counts per ECO evidence code across feature annotations.',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },

  {
    name: 'export_protein_data',
    description: 'Export the full entry as raw text: gff (features), txt (UniProt flat file, EMBL-like), xml (UniProt XML) or fasta.',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
        format: { type: 'string', enum: EXPORT_FORMATS, description: 'Export format' },
      },
      required: ['accession', 'format'],
    },
  },
  {
    name: 'validate_accession',
    description: 'Check if accession numbers are valid',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number to validate' },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_taxonomy_info',
    description: 'Detailed taxonomic information for organisms',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },
];
