import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies } from '../client.js';

const isValidXrefArgs = (
  args: any,
): args is { gene_id: string; species?: string; external_db?: string; all_levels?: boolean } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.gene_id === 'string' &&
    args.gene_id.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.external_db === undefined || typeof args.external_db === 'string') &&
    (args.all_levels === undefined || typeof args.all_levels === 'boolean')
  );
};

const isValidMapCoordinatesArgs = (
  args: any,
): args is { region: string; species?: string; target_assembly: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    typeof args.target_assembly === 'string' &&
    args.target_assembly.length > 0
  );
};

export const tools: Tool[] = [
  {
    name: 'get_xrefs',
    description: 'Get external database cross-references for genes',
    inputSchema: {
      type: 'object',
      properties: {
        gene_id: { type: 'string', description: 'Ensembl gene ID' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        external_db: {
          type: 'string',
          description: 'Specific external database (optional)',
        },
        all_levels: {
          type: 'boolean',
          description: 'Include transcript and translation xrefs (default: false)',
        },
      },
      required: ['gene_id'],
    },
  },
  {
    name: 'map_coordinates',
    description: 'Convert coordinates between genome assemblies',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Genomic region (chr:start-end)' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        target_assembly: { type: 'string', description: 'Target assembly name' },
      },
      required: ['region', 'target_assembly'],
    },
  },
];

async function handleGetXrefs(args: Record<string, unknown>) {
  if (!isValidXrefArgs(args)) {
    throw new Error('Invalid xref arguments');
  }

  const species = getDefaultSpecies(args.species);
  const params: Record<string, unknown> = { species };

  if (args.external_db) {
    params.external_db = args.external_db;
  }
  if (args.all_levels) {
    params.all_levels = 1;
  }

  const response = await getClient().get(`/xrefs/id/${args.gene_id}`, { params });
  return response.data;
}

async function handleMapCoordinates(args: Record<string, unknown>) {
  if (!isValidMapCoordinatesArgs(args)) {
    throw new Error('Invalid map coordinates arguments');
  }

  const species = getDefaultSpecies(args.species);
  const region = args.region;

  const response = await getClient().get(
    `/map/coords/${species}/${args.target_assembly}/${region}`,
  );
  return response.data;
}

export const handlers: Record<string, ToolHandler> = {
  get_xrefs: handleGetXrefs,
  map_coordinates: handleMapCoordinates,
};
