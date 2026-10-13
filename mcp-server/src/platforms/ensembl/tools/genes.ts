import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { UpstreamError } from '../../../shared/exceptions.js';
import { getClient, getDefaultSpecies } from '../client.js';

// ── Validation ──────────────────────────────────────────────────────────────

const isValidGeneArgs = (
  args: any,
): args is { gene_id: string; species?: string; expand?: boolean; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.gene_id === 'string' &&
    args.gene_id.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.expand === undefined || typeof args.expand === 'boolean') &&
    (args.format === undefined || ['json', 'fasta', 'gff'].includes(args.format))
  );
};

const isValidTranscriptArgs = (
  args: any,
): args is { gene_id: string; species?: string; canonical_only?: boolean } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.gene_id === 'string' &&
    args.gene_id.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.canonical_only === undefined || typeof args.canonical_only === 'boolean')
  );
};

const isValidSearchArgs = (
  args: any,
): args is { query: string; species?: string; feature?: string; biotype?: string; limit?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.query === 'string' &&
    args.query.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.feature === undefined || ['gene', 'transcript'].includes(args.feature)) &&
    (args.biotype === undefined || typeof args.biotype === 'string') &&
    (args.limit === undefined || (typeof args.limit === 'number' && args.limit > 0 && args.limit <= 200))
  );
};

const isValidBatchArgs = (
  args: any,
): args is { gene_ids: string[]; species?: string; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    Array.isArray(args.gene_ids) &&
    args.gene_ids.length > 0 &&
    args.gene_ids.length <= 200 &&
    args.gene_ids.every((id: any) => typeof id === 'string' && id.length > 0) &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.format === undefined || ['json', 'xml'].includes(args.format))
  );
};

// ── Tool definitions ────────────────────────────────────────────────────────

export const tools: Tool[] = [
  {
    name: 'lookup_gene',
    description:
      'Get detailed gene information by Ensembl stable ID. NOTE: Only accepts Ensembl IDs (e.g., ENSG00000139618), NOT gene symbols. For gene symbol lookup, use search_genes instead.',
    inputSchema: {
      type: 'object',
      properties: {
        gene_id: {
          type: 'string',
          description:
            'Ensembl gene ID (e.g., ENSG00000139618 for BRCA2). Use search_genes for gene symbols like BRCA2, TP53',
        },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        expand: {
          type: 'boolean',
          description: 'Include transcript and exon details (default: false)',
        },
        format: {
          type: 'string',
          enum: ['json', 'fasta', 'gff'],
          description: 'Output format (default: json)',
        },
      },
      required: ['gene_id'],
    },
  },
  {
    name: 'get_transcripts',
    description: 'Get all transcripts for a gene with detailed structure',
    inputSchema: {
      type: 'object',
      properties: {
        gene_id: { type: 'string', description: 'Ensembl gene ID' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        canonical_only: {
          type: 'boolean',
          description: 'Return only canonical transcript (default: false)',
        },
      },
      required: ['gene_id'],
    },
  },
  {
    name: 'search_genes',
    description:
      'Look up genes by gene symbol (e.g., BRCA1, TP53). This is the primary tool for converting gene symbols to Ensembl IDs. Uses exact symbol matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Gene symbol (e.g., BRCA1, TP53, EGFR). Returns Ensembl gene ID and details.',
        },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        feature: {
          type: 'string',
          enum: ['gene', 'transcript'],
          description: 'Feature type to search (default: gene)',
        },
        biotype: {
          type: 'string',
          description: 'Filter by biotype (e.g., protein_coding, lncRNA)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (1-200, default: 25)',
          minimum: 1,
          maximum: 200,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'batch_gene_lookup',
    description: 'Look up multiple genes simultaneously',
    inputSchema: {
      type: 'object',
      properties: {
        gene_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of gene IDs (max 200)',
          minItems: 1,
          maxItems: 200,
        },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        format: {
          type: 'string',
          enum: ['json', 'xml'],
          description: 'Output format (default: json)',
        },
      },
      required: ['gene_ids'],
    },
  },
];

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleLookupGene(args: Record<string, unknown>) {
  if (!isValidGeneArgs(args)) {
    throw new Error('Invalid gene lookup arguments');
  }

  const species = getDefaultSpecies(args.species);
  const format = args.format || 'json';
  const endpoint = `/lookup/id/${args.gene_id}`;
  const params: Record<string, unknown> = { species };

  if (args.expand) {
    params.expand = 1;
  }
  if (format !== 'json') {
    params.format = format;
  }

  const response = await getClient().get(endpoint, { params });
  return response.data;
}

async function handleGetTranscripts(args: Record<string, unknown>) {
  if (!isValidTranscriptArgs(args)) {
    throw new Error('Invalid transcript arguments');
  }

  const species = getDefaultSpecies(args.species);
  const response = await getClient().get(`/lookup/id/${args.gene_id}`, {
    params: { species, expand: 1 },
  });

  const gene = response.data;
  let transcripts = gene.Transcript || [];

  if (args.canonical_only) {
    transcripts = transcripts.filter((t: any) => t.is_canonical === 1);
  }

  return {
    gene_id: gene.id,
    gene_name: gene.display_name,
    transcript_count: transcripts.length,
    transcripts,
  };
}

async function handleSearchGenes(args: Record<string, unknown>) {
  if (!isValidSearchArgs(args)) {
    throw new Error('Invalid search arguments');
  }

  const species = getDefaultSpecies(args.species);

  try {
    const response = await getClient().get(`/lookup/symbol/${species}/${args.query}`, {
      params: { object_type: args.feature || 'gene' },
    });

    return {
      search_type: 'exact_symbol_match',
      note: 'REST API only supports exact gene symbol lookup, not fuzzy search',
      result: response.data,
    };
  } catch (error) {
    // Only a rejected lookup means "no such symbol"; outages, timeouts and
    // rate limits must reach the agent as structured upstream errors.
    if (!(error instanceof UpstreamError) || (error.kind !== 'not_found' && error.kind !== 'bad_request')) {
      throw error;
    }
    throw new Error(
      `No gene found with symbol: ${args.query}. REST API only supports exact gene symbol lookup. Try exact Ensembl gene symbols (e.g., TP53, BRCA1, BRCA2).`,
    );
  }
}

async function handleBatchGeneLookup(args: Record<string, unknown>) {
  if (!isValidBatchArgs(args)) {
    throw new Error('Invalid batch gene lookup arguments');
  }

  const species = getDefaultSpecies(args.species);
  const format = args.format || 'json';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (format === 'xml') {
    headers['Accept'] = 'text/xml';
  } else {
    headers['Accept'] = 'application/json';
  }

  const response = await getClient().post(
    '/lookup/id',
    { ids: args.gene_ids },
    { params: { species }, headers },
  );

  return response.data;
}

// ── Export ───────────────────────────────────────────────────────────────────

export const handlers: Record<string, ToolHandler> = {
  lookup_gene: handleLookupGene,
  get_transcripts: handleGetTranscripts,
  search_genes: handleSearchGenes,
  batch_gene_lookup: handleBatchGeneLookup,
};
