import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const definitions: Tool[] = [
  {
    name: 'get_target_info',
    description: 'Retrieve core identity details for a target gene including approved symbol, name, biotype, and chromosomal location.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier (e.g., "ENSG00000157764")' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_class',
    description: 'Return ChEMBL target class annotations for a gene.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_alternative_genes',
    description: 'List alternate gene symbols and database cross-references for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_expression',
    description: 'Return baseline expression measurements for a target across tissues and cell types.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_pathways_and_go_terms',
    description: 'List pathway memberships and Gene Ontology annotations for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_homologues',
    description: 'Retrieve cross-species homologues for a target gene.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_subcellular_locations',
    description: 'Return subcellular localisation annotations for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_genetic_constraint',
    description: 'Fetch genetic constraint metrics (gnomAD) for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_mouse_phenotypes',
    description: 'Retrieve mouse knockout phenotypes associated with a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_hallmarks',
    description: 'Return cancer hallmark annotations associated with a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_depmap_essentiality',
    description: 'Fetch DepMap CRISPR essentiality scores across cell lines.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_interactions',
    description: 'Retrieve protein interaction partners for a target from curated databases.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        source_database: { type: 'string', enum: ['intact', 'reactome', 'signor', 'string'], description: 'Limit to specific interaction datasource (intact, reactome, signor, string)' },
        score_threshold: { type: 'number', description: 'Minimum confidence score (0-1)' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_associated_diseases',
    description: 'List diseases linked to a target with association scores.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_known_drugs',
    description: 'Return compounds with known activity on the target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_literature_occurrences',
    description: 'Return literature co-occurrence records for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        additional_entity_ids: { type: 'array', items: { type: 'string' }, description: 'Additional entity IDs to co-filter on' },
        start_year: { type: 'number', description: 'Start year filter' },
        end_year: { type: 'number', description: 'End year filter' },
        start_month: { type: 'number', description: 'Start month filter' },
        end_month: { type: 'number', description: 'End month filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        size: { type: 'number', description: 'Number of rows to return (default 20)' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_safety_information',
    description: 'Retrieve documented safety liabilities for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_tractability',
    description: 'Return tractability assessments across modalities for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_chemical_probes',
    description: 'List available chemical probes and their quality metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },
  {
    name: 'get_target_prioritization',
    description: 'Return target prioritisation scores compiled across data sources.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
      },
      required: ['ensembl_id'],
    },
  },

];
