import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { asRecord } from '../../../shared/json.js';
import { getClient, getDefaultSpecies } from '../client.js';

const isValidAssemblyArgs = (
  args: Record<string, unknown>,
): args is { species?: string; bands?: boolean } => {
  return (
    (args.species === undefined || typeof args.species === 'string') &&
    (args.bands === undefined || typeof args.bands === 'boolean')
  );
};

export const tools: Tool[] = [
  {
    name: 'list_species',
    description: 'Get list of available species and assemblies',
    inputSchema: {
      type: 'object',
      properties: {
        division: {
          type: 'string',
          description: 'Ensembl division (e.g., vertebrates, plants, fungi)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_assembly_info',
    description: 'Get genome assembly information and statistics',
    inputSchema: {
      type: 'object',
      properties: {
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        bands: {
          type: 'boolean',
          description: 'Include chromosome banding patterns (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_karyotype',
    description: 'Get chromosome information and karyotype',
    inputSchema: {
      type: 'object',
      properties: {
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
      },
      required: [],
    },
  },
];

async function handleListSpecies(args: Record<string, unknown>) {
  const params: Record<string, unknown> = {};

  if (args.division) {
    params.division = args.division;
  }

  const response = await getClient().get<unknown>('/info/species', { params });
  return response.data;
}

async function handleGetAssemblyInfo(args: Record<string, unknown>) {
  if (!isValidAssemblyArgs(args)) {
    throw new Error('Invalid assembly info arguments');
  }

  const species = getDefaultSpecies(args.species);
  const params: Record<string, unknown> = {};

  if (args.bands) {
    params.bands = 1;
  }

  const response = await getClient().get<unknown>(`/info/assembly/${species}`, { params });
  return response.data;
}

async function handleGetKaryotype(args: Record<string, unknown>) {
  if (!isValidAssemblyArgs(args)) {
    throw new Error('Invalid karyotype arguments');
  }

  const species = getDefaultSpecies(args.species);

  const response = await getClient().get<unknown>(`/info/assembly/${species}`, {
    params: { bands: 1 },
  });

  const assembly = asRecord(response.data);
  return {
    species,
    assembly_name: assembly.assembly_name,
    karyotype: assembly.karyotype || [],
    chromosomes: assembly.top_level_region || [],
  };
}

export const handlers: Record<string, ToolHandler> = {
  list_species: handleListSpecies,
  get_assembly_info: handleGetAssemblyInfo,
  get_karyotype: handleGetKaryotype,
};
