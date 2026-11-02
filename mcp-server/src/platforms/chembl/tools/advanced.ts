import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { isRejectedLookup } from '../../../shared/exceptions.js';
import { getClient, isValidChemblIdArgs, getExternalUrl } from '../client.js';

const isValidSubstructureSearchArgs = (
  args: any,
): args is { smiles: string; limit?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.smiles === 'string' &&
    args.smiles.length > 0 &&
    (args.limit === undefined || (typeof args.limit === 'number' && args.limit > 0 && args.limit <= 1000))
  );
};

const isValidBatchArgs = (
  args: any,
): args is { chembl_ids: string[] } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    Array.isArray(args.chembl_ids) &&
    args.chembl_ids.length > 0 &&
    args.chembl_ids.length <= 50 &&
    args.chembl_ids.every((id: any) => typeof id === 'string' && id.length > 0)
  );
};

const isValidPropertyFilterArgs = (
  args: any,
): args is {
  min_mw?: number;
  max_mw?: number;
  min_logp?: number;
  max_logp?: number;
  max_hbd?: number;
  max_hba?: number;
  limit?: number;
} => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.min_mw === undefined || (typeof args.min_mw === 'number' && args.min_mw >= 0)) &&
    (args.max_mw === undefined || (typeof args.max_mw === 'number' && args.max_mw >= 0)) &&
    (args.min_logp === undefined || typeof args.min_logp === 'number') &&
    (args.max_logp === undefined || typeof args.max_logp === 'number') &&
    (args.max_hbd === undefined || (typeof args.max_hbd === 'number' && args.max_hbd >= 0)) &&
    (args.max_hba === undefined || (typeof args.max_hba === 'number' && args.max_hba >= 0)) &&
    (args.limit === undefined || (typeof args.limit === 'number' && args.limit > 0 && args.limit <= 1000))
  );
};

export const tools: Tool[] = [
  {
    name: 'substructure_search',
    description: 'Find compounds containing specific substructures',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string', description: 'SMILES string of the substructure query' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['smiles'],
    },
  },
  {
    name: 'batch_compound_lookup',
    description: 'Process multiple ChEMBL IDs efficiently',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ChEMBL compound IDs (1-50)',
          minItems: 1,
          maxItems: 50,
        },
      },
      required: ['chembl_ids'],
    },
  },
  {
    name: 'get_external_references',
    description: 'Get links to external databases (PubChem, DrugBank, PDB, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound or target ID' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'advanced_search',
    description: 'Complex queries with multiple chemical and biological filters',
    inputSchema: {
      type: 'object',
      properties: {
        min_mw: { type: 'number', description: 'Minimum molecular weight (Da)', minimum: 0 },
        max_mw: { type: 'number', description: 'Maximum molecular weight (Da)', minimum: 0 },
        min_logp: { type: 'number', description: 'Minimum LogP value' },
        max_logp: { type: 'number', description: 'Maximum LogP value' },
        max_hbd: { type: 'number', description: 'Maximum hydrogen bond donors', minimum: 0 },
        max_hba: { type: 'number', description: 'Maximum hydrogen bond acceptors', minimum: 0 },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: [],
    },
  },
];

async function handleSubstructureSearch(args: Record<string, unknown>) {
  if (!isValidSubstructureSearchArgs(args)) {
    throw new Error('Invalid substructure search arguments');
  }

  const client = getClient();
  const response = await client.get(
    '/substructure/' + encodeURIComponent(args.smiles) + '.json',
    { params: { limit: args.limit || 25 } },
  );
  return response.data;
}

async function handleBatchCompoundLookup(args: Record<string, unknown>) {
  if (!isValidBatchArgs(args)) {
    throw new Error('Invalid batch arguments');
  }

  const client = getClient();
  const results = [];

  for (const chemblId of args.chembl_ids.slice(0, 10)) {
    try {
      const response = await client.get(`/molecule/${chemblId}.json`);
      results.push({ chembl_id: chemblId, data: response.data, success: true });
    } catch (error) {
      results.push({
        chembl_id: chemblId,
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      });
    }
  }

  return { batch_results: results };
}

async function handleGetExternalReferences(args: Record<string, unknown>) {
  if (!isValidChemblIdArgs(args)) {
    throw new Error('Invalid external references arguments');
  }

  const client = getClient();
  let response;
  let entityType = 'molecule';

  try {
    response = await client.get(`/molecule/${args.chembl_id}.json`);
  } catch (error) {
    if (!isRejectedLookup(error)) throw error;
    try {
      response = await client.get(`/target/${args.chembl_id}.json`);
      entityType = 'target';
    } catch (targetError) {
      if (!isRejectedLookup(targetError)) throw targetError;
      throw new Error('ChEMBL ID not found as molecule or target');
    }
  }

  const entity = response.data;
  const crossRefs = entity.cross_references || [];

  const databases: Record<string, Array<{ id: string; name: string; url: string }>> = {};

  crossRefs.forEach((ref: any) => {
    const source = ref.xref_src || ref.xref_name;
    if (!databases[source]) {
      databases[source] = [];
    }
    databases[source].push({
      id: ref.xref_id,
      name: ref.xref_name,
      url: getExternalUrl(source, ref.xref_id),
    });
  });

  return {
    chembl_id: args.chembl_id,
    entity_type: entityType,
    databases,
  };
}

async function handleAdvancedSearch(args: Record<string, unknown>) {
  if (!isValidPropertyFilterArgs(args)) {
    throw new Error('Invalid advanced search arguments');
  }

  const client = getClient();
  const filters: string[] = [];

  if (args.min_mw !== undefined) {
    filters.push(`molecule_properties__mw_freebase__gte=${args.min_mw}`);
  }
  if (args.max_mw !== undefined) {
    filters.push(`molecule_properties__mw_freebase__lte=${args.max_mw}`);
  }
  if (args.min_logp !== undefined) {
    filters.push(`molecule_properties__alogp__gte=${args.min_logp}`);
  }
  if (args.max_logp !== undefined) {
    filters.push(`molecule_properties__alogp__lte=${args.max_logp}`);
  }
  if (args.max_hbd !== undefined) {
    filters.push(`molecule_properties__hbd__lte=${args.max_hbd}`);
  }
  if (args.max_hba !== undefined) {
    filters.push(`molecule_properties__hba__lte=${args.max_hba}`);
  }

  const filterString = filters.join('&');
  const response = await client.get(`/molecule.json?${filterString}&limit=${args.limit || 25}`);

  return {
    filters: args,
    results: response.data,
  };
}

export const handlers: Record<string, ToolHandler> = {
  substructure_search: handleSubstructureSearch,
  batch_compound_lookup: handleBatchCompoundLookup,
  get_external_references: handleGetExternalReferences,
  advanced_search: handleAdvancedSearch,
};
