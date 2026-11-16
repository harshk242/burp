import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const definitions: Tool[] = [
  {
    name: 'search_entities',
    description: 'Search Open Targets entities and resolve synonyms to canonical IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        query_string: { type: 'string', description: 'Search query (e.g., "BRAF", "melanoma")' },
        entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types to search' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['query_string'],
    },
  },
  {
    name: 'search_suggestions',
    description: 'Return autocomplete suggestions for partially typed queries.',
    inputSchema: {
      type: 'object',
      properties: {
        query_prefix: { type: 'string', description: 'Partial search term (min 3 chars)' },
        entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types to search' },
        max_suggestions: { type: 'number', description: 'Maximum suggestions (default 10)' },
      },
      required: ['query_prefix'],
    },
  },
  {
    name: 'get_similar_targets',
    description: 'Identify targets with similar association profiles to the seed target.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Ensembl gene identifier' },
        threshold: { type: 'number', description: 'Minimum similarity score (default 0.5)' },
        size: { type: 'number', description: 'Maximum results (default 10)' },
      },
      required: ['entity_id'],
    },
  },
  {
    name: 'search_facets',
    description: 'Return facet counts to help filter search results.',
    inputSchema: {
      type: 'object',
      properties: {
        query_string: { type: 'string', description: 'Search query' },
        category_id: { type: 'string', description: 'Restrict to category' },
        entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_variant_info',
    description: 'Retrieve core metadata and functional annotations for a variant.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: { type: 'string', description: 'Variant identifier (e.g., "7_140453136_A_T")' },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'get_variant_credible_sets',
    description: 'List credible sets that include a specific variant.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: { type: 'string', description: 'Variant identifier' },
        study_types: { type: 'array', items: { type: 'string', enum: ['eqtl', 'gwas', 'pqtl', 'sceqtl', 'scpqtl', 'scsqtl', 'sctuqtl', 'sqtl', 'tuqtl'] }, description: 'Filter by study types' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'get_variant_pharmacogenomics',
    description: 'Retrieve pharmacogenomic annotations for a variant.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: { type: 'string', description: 'Variant identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'get_variant_evidences',
    description: 'Retrieve evidence strings linking a variant to targets or diseases.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: { type: 'string', description: 'Variant identifier' },
        datasource_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by datasources' },
        size: { type: 'number', description: 'Number of rows (default 10)' },
        cursor: { type: 'string', description: 'Pagination cursor' },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'get_variant_intervals',
    description: 'Retrieve enhancer-to-gene (E2G) predictions overlapping a variant.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: { type: 'string', description: 'Variant identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'get_variant_protein_coordinates',
    description: 'Retrieve protein-level consequences for a variant.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: { type: 'string', description: 'Variant identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['variant_id'],
    },
  },
  {
    name: 'get_study_info',
    description: 'Retrieve metadata and cohort details for a GWAS study.',
    inputSchema: {
      type: 'object',
      properties: {
        study_id: { type: 'string', description: 'Study identifier (e.g., "GCST90002357")' },
      },
      required: ['study_id'],
    },
  },
  {
    name: 'get_studies_by_disease',
    description: 'List studies linked to one or more diseases.',
    inputSchema: {
      type: 'object',
      properties: {
        disease_ids: { type: 'array', items: { type: 'string' }, description: 'Disease identifiers' },
        enable_indirect: { type: 'boolean', description: 'Include indirect associations (default false)' },
        study_id: { type: 'string', description: 'Filter to specific study' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['disease_ids'],
    },
  },
  {
    name: 'get_study_credible_sets',
    description: 'Retrieve fine-mapped credible sets for a study.',
    inputSchema: {
      type: 'object',
      properties: {
        study_id: { type: 'string', description: 'Study identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['study_id'],
    },
  },
  {
    name: 'get_credible_set_by_id',
    description: 'Fetch detailed information for a specific study locus credible set.',
    inputSchema: {
      type: 'object',
      properties: {
        study_locus_id: { type: 'string', description: 'Credible set identifier' },
      },
      required: ['study_locus_id'],
    },
  },
  {
    name: 'get_credible_set_colocalisation',
    description: 'Retrieve colocalisation results for a credible set.',
    inputSchema: {
      type: 'object',
      properties: {
        study_locus_id: { type: 'string', description: 'Credible set identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['study_locus_id'],
    },
  },
  {
    name: 'get_credible_sets',
    description: 'Query credible sets with flexible filtering options.',
    inputSchema: {
      type: 'object',
      properties: {
        study_locus_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by credible set IDs' },
        study_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by study IDs' },
        variant_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by variant IDs' },
        study_types: { type: 'array', items: { type: 'string', enum: ['eqtl', 'gwas', 'pqtl', 'sceqtl', 'scpqtl', 'scsqtl', 'sctuqtl', 'sqtl', 'tuqtl'] }, description: 'Filter by study types' },
        regions: { type: 'array', items: { type: 'string' }, description: 'Filter by genomic regions' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'get_api_metadata',
    description: 'Return Open Targets Platform release metadata.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_association_datasources',
    description: 'List sources contributing target-disease association evidence.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_interaction_resources',
    description: 'Enumerate interaction databases integrated into Open Targets.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_gene_ontology_terms',
    description: 'Resolve Gene Ontology identifiers to human-readable labels.',
    inputSchema: {
      type: 'object',
      properties: {
        go_ids: { type: 'array', items: { type: 'string' }, description: 'GO identifiers (e.g., ["GO:0006915"])' },
      },
      required: ['go_ids'],
    },
  },
  {
    name: 'map_ids',
    description: 'Map free-text terms to canonical Open Targets identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        query_terms: { type: 'array', items: { type: 'string' }, description: 'Free-text terms to map' },
        entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types to consider' },
      },
      required: ['query_terms'],
    },
  },
];
