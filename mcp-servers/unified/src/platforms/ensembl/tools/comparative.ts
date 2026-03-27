import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, getDefaultSpecies } from '../client.js';

// ── Validation ──────────────────────────────────────────────────────────────

const isValidHomologArgs = (
  args: any,
): args is {
  gene_id: string;
  species?: string;
  target_species?: string;
  type?: string;
  format?: string;
} => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.gene_id === 'string' &&
    args.gene_id.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.target_species === undefined || typeof args.target_species === 'string') &&
    (args.type === undefined || ['orthologues', 'paralogues', 'all'].includes(args.type)) &&
    (args.format === undefined || ['json', 'xml'].includes(args.format))
  );
};

const isValidGeneTreeArgs = (
  args: any,
): args is { gene_id: string; species?: string; format?: string; clusterset_id?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.gene_id === 'string' &&
    args.gene_id.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.format === undefined || ['json', 'newick', 'phyloxml'].includes(args.format)) &&
    (args.clusterset_id === undefined || typeof args.clusterset_id === 'string')
  );
};

// ── Tool definitions ────────────────────────────────────────────────────────

export const tools: Tool[] = [
  {
    name: 'get_homologs',
    description: 'Find orthologous and paralogous genes across species',
    inputSchema: {
      type: 'object',
      properties: {
        gene_id: { type: 'string', description: 'Ensembl gene ID' },
        species: {
          type: 'string',
          description: 'Source species name (default: homo_sapiens)',
        },
        target_species: {
          type: 'string',
          description: 'Target species to search (optional)',
        },
        type: {
          type: 'string',
          enum: ['orthologues', 'paralogues', 'all'],
          description: 'Homolog type (default: all)',
        },
        format: {
          type: 'string',
          enum: ['json', 'xml'],
          description: 'Output format (default: json)',
        },
      },
      required: ['gene_id'],
    },
  },
  {
    name: 'get_gene_tree',
    description: 'Get phylogenetic tree for gene family',
    inputSchema: {
      type: 'object',
      properties: {
        gene_id: { type: 'string', description: 'Ensembl gene ID' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        format: {
          type: 'string',
          enum: ['json', 'newick', 'phyloxml'],
          description: 'Tree format (default: json)',
        },
        clusterset_id: {
          type: 'string',
          description: 'Specific clusterset ID (optional)',
        },
      },
      required: ['gene_id'],
    },
  },
];

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleGetHomologs(args: Record<string, unknown>) {
  if (!isValidHomologArgs(args)) {
    throw new Error('Invalid homolog arguments');
  }

  const species = getDefaultSpecies(args.species);
  const type = args.type || 'all';
  const format = args.format || 'json';

  const params: Record<string, unknown> = { type };

  if (args.target_species) {
    params.target_species = args.target_species;
  }
  if (format !== 'json') {
    params.format = format;
  }

  const response = await getClient().get(`/homology/id/${species}/${args.gene_id}`, { params });
  return response.data;
}

async function handleGetGeneTree(args: Record<string, unknown>) {
  if (!isValidGeneTreeArgs(args)) {
    throw new Error('Invalid gene tree arguments');
  }

  const format = args.format || 'json';
  const endpoint = `/genetree/id/${args.gene_id}`;
  const params: Record<string, unknown> = {};

  if (args.clusterset_id) {
    params.clusterset_id = args.clusterset_id;
  }
  if (format !== 'json') {
    params.format = format;
  }

  const response = await getClient().get(endpoint, { params });
  return response.data;
}

// ── Export ───────────────────────────────────────────────────────────────────

export const handlers: Record<string, ToolHandler> = {
  get_homologs: handleGetHomologs,
  get_gene_tree: handleGetGeneTree,
};
