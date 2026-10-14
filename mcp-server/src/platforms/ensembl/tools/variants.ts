import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies, formatGenomicRegion } from '../client.js';

const isValidVariantArgs = (
  args: any,
): args is { region: string; species?: string; format?: string; consequence_type?: string[] } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.format === undefined || ['json', 'vcf'].includes(args.format)) &&
    (args.consequence_type === undefined ||
      (Array.isArray(args.consequence_type) &&
        args.consequence_type.every((c: any) => typeof c === 'string')))
  );
};

const isValidVariantConsequenceArgs = (
  args: any,
): args is { variants: string[]; species?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    Array.isArray(args.variants) &&
    args.variants.length > 0 &&
    args.variants.every((v: any) => typeof v === 'string' && v.length > 0) &&
    (args.species === undefined || typeof args.species === 'string')
  );
};

export const tools: Tool[] = [
  {
    name: 'get_variants',
    description: 'Get genetic variants in a genomic region',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Genomic region (chr:start-end)' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        format: {
          type: 'string',
          enum: ['json', 'vcf'],
          description: 'Output format (default: json)',
        },
        consequence_type: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by consequence types',
        },
      },
      required: ['region'],
    },
  },
  {
    name: 'get_variant_consequences',
    description: 'Predict consequences of variants on genes and transcripts',
    inputSchema: {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Variant IDs or HGVS notation',
        },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
      },
      required: ['variants'],
    },
  },
];

async function handleGetVariants(args: Record<string, unknown>) {
  if (!isValidVariantArgs(args)) {
    throw new Error('Invalid variant arguments');
  }

  const species = getDefaultSpecies(args.species);
  const region = formatGenomicRegion(args.region);
  const params: Record<string, unknown> = { feature: 'variation' };

  if (args.consequence_type && args.consequence_type.length > 0) {
    params.consequence_type = args.consequence_type.join(',');
  }

  const response = await getClient().get(`/overlap/region/${species}/${region}`, { params });
  return response.data;
}

async function handleGetVariantConsequences(args: Record<string, unknown>) {
  if (!isValidVariantConsequenceArgs(args)) {
    throw new Error('Invalid variant consequence arguments');
  }

  const species = getDefaultSpecies(args.species);

  const response = await getClient().post(
    `/vep/${species}/region`,
    { variants: args.variants },
    { headers: { 'Content-Type': 'application/json' } },
  );

  return response.data;
}

export const handlers: Record<string, ToolHandler> = {
  get_variants: handleGetVariants,
  get_variant_consequences: handleGetVariantConsequences,
};
