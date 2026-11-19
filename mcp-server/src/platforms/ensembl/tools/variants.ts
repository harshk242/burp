import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { asArray, asRecord } from '../../../shared/json.js';
import { getClient, getDefaultSpecies } from '../client.js';

const isValidVariantArgs = (
  args: Record<string, unknown>,
): args is { region: string; species?: string; consequence_type?: string[] } => {
  return (
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.consequence_type === undefined ||
      (Array.isArray(args.consequence_type) &&
        args.consequence_type.every((c: unknown) => typeof c === 'string')))
  );
};

const isValidVariantConsequenceArgs = (
  args: Record<string, unknown>,
): args is { variants: string[]; species?: string } => {
  return (
    Array.isArray(args.variants) &&
    args.variants.length > 0 &&
    args.variants.every((v: unknown) => typeof v === 'string' && v.length > 0) &&
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
    description: 'Predict consequences of variant IDs (rs699), HGVS (ENST00000269305.9:c.215C>G), or VEP region/allele strings (7 140753336 140753336 A/T 1). Mixed forms are supported.',
    inputSchema: {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Variant IDs, HGVS notations, or space-separated VEP region/allele strings',
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
    const rows: unknown[] = [];
    for (const term of args.consequence_type) {
      const response = await getClient().get<unknown>(`/overlap/region/${species}/${region}`, {
        params: { ...params, so_term: term },
      });
      rows.push(...asArray(response.data));
    }
    return [...new Map(rows.map(row => {
      const { id, start, end, alleles } = asRecord(row);
      return [JSON.stringify([id, start, end, alleles]), row];
    })).values()];
  }

  const response = await getClient().get<unknown>(`/overlap/region/${species}/${region}`, { params });
  return response.data;
}

async function handleGetVariantConsequences(args: Record<string, unknown>) {
  if (!isValidVariantConsequenceArgs(args)) {
    throw new Error('Invalid variant consequence arguments');
  }

  const species = getDefaultSpecies(args.species);

  const results: unknown[] = [];
  for (const form of ['id', 'hgvs', 'region'] as const) {
    const variants = args.variants.filter(v =>
      (/\s/.test(v.trim()) ? 'region' : v.includes(':') ? 'hgvs' : 'id') === form);
    if (!variants.length) continue;
    const key = form === 'id' ? 'ids' : form === 'hgvs' ? 'hgvs_notations' : 'variants';
    const response = await getClient().post<unknown>(
      "/vep/" + species + "/" + form, { [key]: variants },
      { headers: { 'Content-Type': 'application/json' } },
    );
    results.push(...asArray(response.data));
  }
  return results;
}

export const handlers: Record<string, ToolHandler> = {
  get_variants: handleGetVariants,
  get_variant_consequences: handleGetVariantConsequences,
};
