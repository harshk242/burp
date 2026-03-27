import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies } from '../client.js';

// ── Validation ──────────────────────────────────────────────────────────────

const isValidAssemblyArgs = (
  args: any,
): args is { species?: string; bands?: boolean } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.bands === undefined || typeof args.bands === 'boolean')
  );
};

// ── Tool definitions ────────────────────────────────────────────────────────

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

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleListSpecies(args: Record<string, unknown>) {
  const params: Record<string, unknown> = {};

  if (args.division) {
    params.division = args.division;
  }

  const response = await getClient().get('/info/species', { params });
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

  const response = await getClient().get(`/info/assembly/${species}`, { params });
  return response.data;
}

async function handleGetKaryotype(args: Record<string, unknown>) {
  if (!isValidAssemblyArgs(args)) {
    throw new Error('Invalid karyotype arguments');
  }

  const species = getDefaultSpecies(args.species);

  const response = await getClient().get(`/info/assembly/${species}`, {
    params: { bands: 1 },
  });

  return {
    species,
    assembly_name: response.data.assembly_name,
    karyotype: response.data.karyotype || [],
    chromosomes: response.data.top_level_region || [],
  };
}

// ── Export ───────────────────────────────────────────────────────────────────

export const handlers: Record<string, ToolHandler> = {
  list_species: handleListSpecies,
  get_assembly_info: handleGetAssemblyInfo,
  get_karyotype: handleGetKaryotype,
};
