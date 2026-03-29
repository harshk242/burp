import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** All UniProt tool definitions. */
export const tools: Tool[] = [
  // ── Search tools ──────────────────────────────────────────────────────
  {
    name: 'search_proteins',
    description: 'Search UniProt database for proteins by name, keyword, or organism',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (protein name, keyword, or complex search)' },
        organism: { type: 'string', description: 'Organism name or taxonomy ID to filter results' },
        size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
        format: { type: 'string', enum: ['json', 'tsv', 'fasta', 'xml'], description: 'Output format (default: json)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_by_gene',
    description:
      'Search for proteins by gene name or symbol. Defaults to human (Homo sapiens) if no species specified.',
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
        size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
      },
      required: ['gene'],
    },
  },
  {
    name: 'search_by_function',
    description: 'Search proteins by GO terms or functional annotations',
    inputSchema: {
      type: 'object',
      properties: {
        goTerm: { type: 'string', description: 'Gene Ontology term (e.g., GO:0005524)' },
        function: { type: 'string', description: 'Functional description or keyword' },
        organism: { type: 'string', description: 'Organism name or taxonomy ID to filter results' },
        size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
      },
      required: [],
    },
  },
  {
    name: 'search_by_localization',
    description: 'Find proteins by subcellular localization',
    inputSchema: {
      type: 'object',
      properties: {
        localization: { type: 'string', description: 'Subcellular localization (e.g., nucleus, mitochondria)' },
        organism: { type: 'string', description: 'Organism name or taxonomy ID to filter results' },
        size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
      },
      required: ['localization'],
    },
  },
  {
    name: 'search_by_taxonomy',
    description: 'Search by detailed taxonomic classification',
    inputSchema: {
      type: 'object',
      properties: {
        taxonomyId: { type: 'number', description: 'NCBI taxonomy ID', minimum: 1 },
        taxonomyName: { type: 'string', description: 'Taxonomic name (e.g., Mammalia, Bacteria)' },
        size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
      },
      required: [],
    },
  },
  {
    name: 'advanced_search',
    description: 'Complex queries with multiple filters (length, mass, organism, function)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Base search query' },
        organism: { type: 'string', description: 'Organism name or taxonomy ID' },
        minLength: { type: 'number', description: 'Minimum sequence length', minimum: 1 },
        maxLength: { type: 'number', description: 'Maximum sequence length' },
        minMass: { type: 'number', description: 'Minimum molecular mass (Da)', minimum: 1 },
        maxMass: { type: 'number', description: 'Maximum molecular mass (Da)' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Array of keywords to include' },
        size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
      },
      required: [],
    },
  },

  // ── Single-protein info tools ─────────────────────────────────────────
  {
    name: 'get_protein_info',
    description: 'Get detailed information for a specific protein by UniProt accession',
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
    description: 'Get functional features and domains for a protein',
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
    description: 'Disease-associated variants and mutations',
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

  // ── Comparative & evolutionary tools ──────────────────────────────────
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
    description: 'Find homologous proteins across different species',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
        organism: { type: 'string', description: 'Target organism to find homologs in' },
        size: { type: 'number', description: 'Number of results to return (1-100, default: 25)', minimum: 1, maximum: 100 },
      },
      required: ['accession'],
    },
  },
  {
    name: 'get_protein_orthologs',
    description: 'Identify orthologous proteins for evolutionary studies',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
        organism: { type: 'string', description: 'Target organism to find orthologs in' },
        size: { type: 'number', description: 'Number of results to return (1-100, default: 25)', minimum: 1, maximum: 100 },
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

  // ── Batch & cross-reference tools ─────────────────────────────────────
  {
    name: 'batch_protein_lookup',
    description: 'Process multiple accessions efficiently',
    inputSchema: {
      type: 'object',
      properties: {
        accessions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of UniProt accession numbers (1-100)',
          minItems: 1,
          maxItems: 100,
        },
        format: { type: 'string', enum: ['json', 'tsv', 'fasta'], description: 'Output format (default: json)' },
      },
      required: ['accessions'],
    },
  },
  {
    name: 'get_external_references',
    description: 'Links to other databases (PDB, EMBL, RefSeq, etc.)',
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
    description: 'Quality scores for different annotations',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
      },
      required: ['accession'],
    },
  },

  // ── Export & utility tools ────────────────────────────────────────────
  {
    name: 'export_protein_data',
    description: 'Export data in specialized formats (GFF, GenBank, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession number' },
        format: { type: 'string', enum: ['gff', 'genbank', 'embl', 'xml'], description: 'Export format' },
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
