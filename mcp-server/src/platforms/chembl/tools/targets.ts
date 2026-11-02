import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, isValidChemblIdArgs } from '../client.js';

export const tools: Tool[] = [
  {
    name: 'search_targets',
    description: 'Search for biological targets by name or type',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Target name or search query' },
        target_type: { type: 'string', description: 'Target type filter (e.g., SINGLE PROTEIN, PROTEIN COMPLEX)' },
        organism: { type: 'string', description: 'Organism filter' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_target_info',
    description: 'Get detailed information for a specific target by ChEMBL target ID',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL target ID (e.g., CHEMBL2095173)' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'get_target_compounds',
    description: 'Get compounds tested against a specific target',
    inputSchema: {
      type: 'object',
      properties: {
        target_chembl_id: { type: 'string', description: 'ChEMBL target ID' },
        activity_type: { type: 'string', description: 'Activity type filter (e.g., IC50, Ki, Kd)' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['target_chembl_id'],
    },
  },
  {
    name: 'search_by_uniprot',
    description: 'Find ChEMBL targets by UniProt accession',
    inputSchema: {
      type: 'object',
      properties: {
        uniprot_id: { type: 'string', description: 'UniProt accession number' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['uniprot_id'],
    },
  },
  {
    name: 'get_target_pathways',
    description: 'Get biological pathways associated with a target',
    inputSchema: {
      type: 'object',
      properties: {
        target_chembl_id: { type: 'string', description: 'ChEMBL target ID' },
      },
      required: ['target_chembl_id'],
    },
  },
];

async function handleSearchTargets(args: Record<string, unknown>) {
  const client = getClient();
  const response = await client.get('/target/search.json', {
    params: { q: args.query as string, limit: (args.limit as number) || 25 },
  });
  return response.data;
}

async function handleGetTargetInfo(args: Record<string, unknown>) {
  if (!isValidChemblIdArgs(args)) {
    throw new Error('Invalid arguments');
  }

  const client = getClient();
  const response = await client.get(`/target/${args.chembl_id}.json`);
  return response.data;
}

async function handleGetTargetCompounds(args: Record<string, unknown>) {
  if (!args || typeof args.target_chembl_id !== 'string') {
    throw new Error('Invalid target compounds arguments');
  }

  const client = getClient();
  const params: Record<string, unknown> = {
    target_chembl_id: args.target_chembl_id,
    limit: (args.limit as number) || 25,
  };

  if (args.activity_type) {
    params.standard_type = args.activity_type;
  }

  const response = await client.get('/activity.json', { params });
  const activities = response.data.activities || [];
  const compoundIds = [...new Set(activities.map((a: any) => a.molecule_chembl_id))];

  return {
    target_chembl_id: args.target_chembl_id,
    total_activities: activities.length,
    unique_compounds: compoundIds.length,
    compound_ids: compoundIds.slice(0, 100),
    activities: activities.slice(0, 50),
  };
}

async function handleSearchByUniprot(args: Record<string, unknown>) {
  if (!args || typeof args.uniprot_id !== 'string') {
    throw new Error('Invalid UniProt arguments');
  }

  const client = getClient();
  const response = await client.get('/target/search.json', {
    params: { q: args.uniprot_id, limit: (args.limit as number) || 25 },
  });
  return response.data;
}

async function handleGetTargetPathways(args: Record<string, unknown>) {
  if (!args || typeof args.target_chembl_id !== 'string') {
    throw new Error('Invalid target pathways arguments');
  }

  const client = getClient();
  const targetResponse = await client.get(`/target/${args.target_chembl_id}.json`);
  const target = targetResponse.data;

  return {
    target_chembl_id: args.target_chembl_id,
    target_name: target.pref_name,
    target_type: target.target_type,
    cross_references: target.cross_references || [],
    pathways: (target.cross_references || []).filter(
      (ref: any) => ref.xref_src === 'Reactome' || ref.xref_src === 'KEGG' || ref.xref_src === 'WikiPathways',
    ),
  };
}

export const handlers: Record<string, ToolHandler> = {
  search_targets: handleSearchTargets,
  get_target_info: handleGetTargetInfo,
  get_target_compounds: handleGetTargetCompounds,
  search_by_uniprot: handleSearchByUniprot,
  get_target_pathways: handleGetTargetPathways,
};
