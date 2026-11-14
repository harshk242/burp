import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies } from '../client.js';

const isValidRegulatoryArgs = (
  args: any,
): args is { region: string; species?: string; feature_type?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.feature_type === undefined || typeof args.feature_type === 'string')
  );
};

const isValidMotifArgs = (
  args: any,
): args is { region: string; species?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string')
  );
};

export const tools: Tool[] = [
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

  const data = args.feature_type ? response.data.filter((row: any) =>
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
  get_regulatory_features: handleGetRegulatoryFeatures,
  get_motif_features: handleGetMotifFeatures,
};
