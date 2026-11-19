import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { optionalNumber, optionalString } from '../../../shared/args.js';
import { asRecord, optRecord } from '../../../shared/json.js';
import { getClient, isValidChemblIdArgs } from '../client.js';

const isValidCompoundSearchArgs = (
  args: Record<string, unknown>,
): args is { query: string; limit?: number; offset?: number } => {
  return (
    typeof args.query === 'string' &&
    args.query.length > 0 &&
    (args.limit === undefined || (typeof args.limit === 'number' && args.limit > 0 && args.limit <= 1000)) &&
    (args.offset === undefined || (typeof args.offset === 'number' && args.offset >= 0))
  );
};

const isValidSimilaritySearchArgs = (
  args: Record<string, unknown>,
): args is { smiles: string; similarity?: number; limit?: number } => {
  return (
    typeof args.smiles === 'string' &&
    args.smiles.length > 0 &&
    (args.similarity === undefined || (typeof args.similarity === 'number' && args.similarity >= 0 && args.similarity <= 1)) &&
    (args.limit === undefined || (typeof args.limit === 'number' && args.limit > 0 && args.limit <= 1000))
  );
};

export const tools: Tool[] = [
  {
    name: 'search_compounds',
    description: 'Search ChEMBL database for compounds by name, synonym, or identifier',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (compound name, synonym, or identifier)' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
        offset: { type: 'number', description: 'Number of results to skip (default: 0)', minimum: 0 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_compound_info',
    description: 'Get detailed information for a specific compound by ChEMBL ID',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID (e.g., CHEMBL59)' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'search_by_inchi',
    description: 'Search for compounds by InChI key or InChI string',
    inputSchema: {
      type: 'object',
      properties: {
        inchi: { type: 'string', description: 'InChI key or InChI string' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['inchi'],
    },
  },
  {
    name: 'get_compound_structure',
    description: 'Retrieve chemical structure information in various formats',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
        format: { type: 'string', enum: ['smiles', 'inchi', 'molfile', 'sdf'], description: 'Structure format (default: smiles)' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'search_similar_compounds',
    description: 'Find chemically similar compounds using Tanimoto similarity',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string', description: 'SMILES string of the query molecule' },
        similarity: { type: 'number', description: 'Similarity threshold (0-1, default: 0.7)', minimum: 0, maximum: 1 },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['smiles'],
    },
  },
];

async function handleSearchCompounds(args: Record<string, unknown>) {
  if (!isValidCompoundSearchArgs(args)) {
    throw new Error('Invalid compound search arguments');
  }

  const client = getClient();
  const response = await client.get<unknown>('/molecule/search.json', {
    params: { q: args.query, limit: args.limit || 25, offset: args.offset || 0 },
  });
  return response.data;
}

async function handleGetCompoundInfo(args: Record<string, unknown>) {
  if (!isValidChemblIdArgs(args)) {
    throw new Error('Invalid ChEMBL ID arguments');
  }

  const client = getClient();
  const response = await client.get<unknown>(`/molecule/${args.chembl_id}.json`);
  return response.data;
}

async function handleSearchByInchi(args: Record<string, unknown>) {
  if (!args || typeof args.inchi !== 'string') {
    throw new Error('Invalid InChI arguments');
  }

  const client = getClient();
  const response = await client.get<unknown>('/molecule/search.json', {
    params: { q: args.inchi, limit: optionalNumber(args, 'limit') || 25 },
  });
  return response.data;
}

async function handleGetCompoundStructure(args: Record<string, unknown>) {
  if (!args || typeof args.chembl_id !== 'string') {
    throw new Error('Invalid arguments');
  }

  const client = getClient();
  const format = optionalString(args, 'format') || 'smiles';
  if (format === 'sdf') {
    const response = await client.get<unknown>(`/molecule/${args.chembl_id}.sdf`, { responseType: 'text' });
    return { chembl_id: args.chembl_id, structure: response.data, requested_format: format };
  }
  const response = await client.get<unknown>(`/molecule/${args.chembl_id}.json`);
  const compound = asRecord(response.data);
  const field = { smiles: 'canonical_smiles', inchi: 'standard_inchi', molfile: 'molfile' }[format];
  if (!field) throw new Error('Invalid structure format');
  const structures = optRecord(compound.molecule_structures);

  return {
    chembl_id: compound.molecule_chembl_id,
    structure: structures?.[field] ?? null,
    structures: structures ?? {},
    requested_format: format,
  };
}

async function handleSearchSimilarCompounds(args: Record<string, unknown>) {
  if (!isValidSimilaritySearchArgs(args)) {
    throw new Error('Invalid similarity search arguments');
  }

  const client = getClient();
  const similarity = args.similarity !== undefined ? Math.round(args.similarity * 100) : 70;
  const response = await client.get<unknown>(
    '/similarity/' + encodeURIComponent(args.smiles) + '/' + similarity + '.json',
    { params: { limit: args.limit || 25 } },
  );
  return response.data;
}

export const handlers: Record<string, ToolHandler> = {
  search_compounds: handleSearchCompounds,
  get_compound_info: handleGetCompoundInfo,
  search_by_inchi: handleSearchByInchi,
  get_compound_structure: handleGetCompoundStructure,
  search_similar_compounds: handleSearchSimilarCompounds,
};
