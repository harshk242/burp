import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const definitions: Tool[] = [
  {
    name: 'get_disease_info',
    description: 'Retrieve core metadata for an Open Targets disease entity. Accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.). Use search_entities to find disease IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        efo_id: { type: 'string', description: 'Disease identifier from any ontology (e.g., "MONDO_0004975" for Alzheimer\'s, "EFO_0003884" for asthma). Use search_entities with entity_names=["disease"] to find IDs.' },
      },
      required: ['efo_id'],
    },
  },
  {
    name: 'get_disease_associated_targets',
    description: 'List targets associated with a disease, including evidence scores. Accepts disease IDs from any ontology.',
    inputSchema: {
      type: 'object',
      properties: {
        efo_id: { type: 'string', description: 'Disease identifier from any ontology (EFO, MONDO, Orphanet, etc.)' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['efo_id'],
    },
  },
  {
    name: 'get_disease_phenotypes',
    description: 'Fetch HPO phenotype annotations linked to a disease. Accepts disease IDs from any ontology.',
    inputSchema: {
      type: 'object',
      properties: {
        efo_id: { type: 'string', description: 'Disease identifier from any ontology (EFO, MONDO, Orphanet, etc.)' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['efo_id'],
    },
  },
  {
    name: 'get_disease_otar_projects',
    description: 'List Open Targets Associated Research (OTAR) projects linked to a disease. Accepts disease IDs from any ontology.',
    inputSchema: {
      type: 'object',
      properties: {
        efo_id: { type: 'string', description: 'Disease identifier from any ontology (EFO, MONDO, Orphanet, etc.)' },
      },
      required: ['efo_id'],
    },
  },
  {
    name: 'get_drug_info',
    description: 'Fetch identity, indication, and mechanism data for a drug.',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'Drug identifier (e.g., "CHEMBL1862")' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_drug_cross_references',
    description: 'Retrieve cross-database identifiers related to a drug.',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'Drug identifier' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_drug_linked_diseases',
    description: 'List diseases connected to a drug across indications and mechanisms.',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'Drug identifier' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_drug_linked_targets',
    description: 'Return targets linked to a drug via mechanism-of-action data.',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'Drug identifier' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_drug_adverse_events',
    description: 'Retrieve adverse event signals associated with a drug.',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'Drug identifier' },
        page_index: { type: 'number', description: 'Page index (default 0)' },
        page_size: { type: 'number', description: 'Page size (default 10)' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_drug_pharmacovigilance',
    description: 'Summarise high-level pharmacovigilance data for a drug.',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'Drug identifier' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_drug_warnings',
    description: 'Fetch detailed regulatory warnings, including withdrawals and boxed labels.',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'Drug identifier' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_target_disease_evidence',
    description: 'Retrieve evidence strings linking a target to a disease.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        efo_id: { type: 'string', description: 'Disease identifier' },
        datasource_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by datasource IDs' },
        size: { type: 'number', description: 'Number of rows (default 10)' },
        cursor: { type: 'string', description: 'Pagination cursor' },
      },
      required: ['ensembl_id', 'efo_id'],
    },
  },
  {
    name: 'get_target_disease_biomarkers',
    description: 'Inspect evidence for biomarker annotations linking a target and disease.',
    inputSchema: {
      type: 'object',
      properties: {
        ensembl_id: { type: 'string', description: 'Target identifier' },
        efo_id: { type: 'string', description: 'Disease identifier' },
        size: { type: 'number', description: 'Number of rows (default 10)' },
        cursor: { type: 'string', description: 'Pagination cursor' },
      },
      required: ['ensembl_id', 'efo_id'],
    },
  },

];
