import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies } from '../client.js';

const isValidRegulatoryArgs = (
  args: Record<string, unknown>,
): args is { region: string; species?: string; feature_type?: string } => {
  return (
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.feature_type === undefined || typeof args.feature_type === 'string')
  );
};

const isValidMotifArgs = (
  args: Record<string, unknown>,
): args is { region: string; species?: string } => {
  return (
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string')
  );
};

export const tools: Tool[] = [
  {
    name: 'get_binding_matrix',
    description: 'Retrieve a transcription factor position frequency binding matrix by Ensembl matrix ID',
    inputSchema: {
      type: 'object',
      properties: {
        binding_matrix: { type: 'string', description: 'Binding matrix ID (e.g., ENSPFM0001)' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
      },
      required: ['binding_matrix'],
    },
  },
  {
    name: 'get_regulatory_features',
    description:
      'Get regulatory elements (enhancers, promoters, TFBS) in genomic region',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Genomic region (chr:start-end)' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        feature_type: {
          type: 'string',
          description: 'Filter locally by feature description, e.g., promoter or enhancer (case insensitive)',
        },
      },
      required: ['region'],
    },
  },
  {
    name: 'get_motif_features',
    description: 'Get transcription factor binding motifs in genomic region',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Genomic region (chr:start-end)' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
      },
      required: ['region'],
    },
  },
];

async function handleGetRegulatoryFeatures(args: Record<string, unknown>) {
  if (!isValidRegulatoryArgs(args)) {
    throw new Error('Invalid regulatory feature arguments');
  }

  const species = getDefaultSpecies(args.species);
  const region = args.region;
  const params: Record<string, unknown> = { feature: 'regulatory' };

  const response = await getClient().get(`/overlap/region/${species}/${region}`, { params });

  const data = args.feature_type ? response.data.filter((row: { description?: unknown }) =>
    String(row.description).toLowerCase() === args.feature_type!.toLowerCase()) : response.data;

  if (Array.isArray(data) && data.length === 0) {
    return {
      message: 'No regulatory features found in this region',
      region,
      species,
      suggestion: 'Try a different region or check if regulatory data is available for this species',
    };
  }

  return data;
}

async function handleGetMotifFeatures(args: Record<string, unknown>) {
  if (!isValidMotifArgs(args)) {
    throw new Error('Invalid motif feature arguments');
  }

  const species = getDefaultSpecies(args.species);

  const response = await getClient().get(`/overlap/region/${species}/${args.region}`, {
    params: { feature: 'motif' },
  });
  return response.data;
}

export const handlers: Record<string, ToolHandler> = {
  get_binding_matrix: async args => {
    if (typeof args.binding_matrix !== 'string' || !args.binding_matrix.trim()) {
      throw new Error('binding_matrix must be an Ensembl matrix ID (e.g., ENSPFM0001)');
    }
    return (await getClient().get('/species/' + getDefaultSpecies(args.species as string | undefined) + '/binding_matrix/' + args.binding_matrix + '/')).data;
  },
  get_regulatory_features: handleGetRegulatoryFeatures,
  get_motif_features: handleGetMotifFeatures,
};
