import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies } from '../client.js';

const isValidRegulatoryArgs = (
  args: any,
): args is { region: string; species?: string; feature_type?: string; cell_type?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.feature_type === undefined || typeof args.feature_type === 'string') &&
    (args.cell_type === undefined || typeof args.cell_type === 'string')
  );
};

const isValidMotifArgs = (
  args: any,
): args is { region: string; species?: string; binding_matrix?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.binding_matrix === undefined || typeof args.binding_matrix === 'string')
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
          description: 'Regulatory feature type (optional)',
        },
        cell_type: { type: 'string', description: 'Cell type context (optional)' },
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
        binding_matrix: {
          type: 'string',
          description: 'Specific binding matrix (optional)',
        },
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

  if (args.feature_type) {
    params.feature_type = args.feature_type;
  }
  if (args.cell_type) {
    params.cell_type = args.cell_type;
  }

  const response = await getClient().get(`/overlap/region/${species}/${region}`, { params });

  if (Array.isArray(response.data) && response.data.length === 0) {
    return {
      message: 'No regulatory features found in this region',
      region,
      species,
      suggestion: 'Try a different region or check if regulatory data is available for this species',
    };
  }

  return response.data;
}

async function handleGetMotifFeatures(args: Record<string, unknown>) {
  if (!isValidMotifArgs(args)) {
    throw new Error('Invalid motif feature arguments');
  }

  const species = getDefaultSpecies(args.species);

  if (!args.binding_matrix) {
    return {
      error: 'Region-based motif search not available in REST API',
      message:
        'The Ensembl REST API only supports retrieval of specific binding matrices by ID',
      solution: 'Provide a binding_matrix parameter with a valid binding matrix stable ID',
      alternative:
        'Use the Variant Effect Predictor (VEP) tool for comprehensive region analysis',
      example_id: 'ENSPFM0001',
    };
  }

  const response = await getClient().get(
    `/species/${species}/binding_matrix/${args.binding_matrix}/`,
  );
  return response.data;
}

export const handlers: Record<string, ToolHandler> = {
  get_regulatory_features: handleGetRegulatoryFeatures,
  get_motif_features: handleGetMotifFeatures,
};
