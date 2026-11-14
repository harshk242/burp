import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies } from '../client.js';

const isValidVariantArgs = (
  args: any,
): args is { region: string; species?: string; consequence_type?: string[] } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
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
          description: 'Variant identifiers (e.g., rs699); HGVS notations are not supported by this tool',
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
  const region = args.region;
  const params: Record<string, unknown> = { feature: 'variation' };

  if (args.consequence_type?.length) {
    // The overlap endpoint accepts one SO term per request; union multiple terms.
    const rows = [];
    for (const term of args.consequence_type) {
      const response = await getClient().get(`/overlap/region/${species}/${region}`, {
        params: { ...params, so_term: term },
      });
      rows.push(...response.data);
    }
    return [...new Map(rows.map(row => [JSON.stringify([row.id, row.start, row.end, row.alleles]), row])).values()];
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
    `/vep/${species}/id`,
    { ids: args.variants },
    { headers: { 'Content-Type': 'application/json' } },
  );

  return response.data;
}

export const handlers: Record<string, ToolHandler> = {
  get_variants: handleGetVariants,
  get_variant_consequences: handleGetVariantConsequences,
};
