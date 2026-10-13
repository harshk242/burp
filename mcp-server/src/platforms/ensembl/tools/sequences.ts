import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getToolCallContext } from '../../../shared/tool-call-context.js';
import { getClient, getDefaultSpecies, formatGenomicRegion } from '../client.js';

// ── Validation ──────────────────────────────────────────────────────────────

const isValidSequenceArgs = (
  args: any,
): args is {
  region: string;
  species?: string;
  format?: string;
  mask?: string;
  multiple_sequences?: boolean;
} => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.region === 'string' &&
    args.region.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.format === undefined || ['json', 'fasta'].includes(args.format)) &&
    (args.mask === undefined || ['hard', 'soft'].includes(args.mask)) &&
    (args.multiple_sequences === undefined || typeof args.multiple_sequences === 'boolean')
  );
};

const isValidCdsArgs = (
  args: any,
): args is { transcript_id: string; species?: string; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.transcript_id === 'string' &&
    args.transcript_id.length > 0 &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.format === undefined || ['json', 'fasta'].includes(args.format))
  );
};

const isValidTranslateArgs = (
  args: any,
): args is { sequence: string; genetic_code?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.sequence === 'string' &&
    args.sequence.length > 0 &&
    (args.genetic_code === undefined ||
      (typeof args.genetic_code === 'number' && args.genetic_code >= 1 && args.genetic_code <= 31))
  );
};

const isValidBatchSequenceArgs = (
  args: any,
): args is { regions: string[]; species?: string; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    Array.isArray(args.regions) &&
    args.regions.length > 0 &&
    args.regions.length <= 50 &&
    args.regions.every((r: any) => typeof r === 'string' && r.length > 0) &&
    (args.species === undefined || typeof args.species === 'string') &&
    (args.format === undefined || ['json', 'fasta'].includes(args.format))
  );
};

// ── Tool definitions ────────────────────────────────────────────────────────

export const tools: Tool[] = [
  {
    name: 'get_sequence',
    description: 'Get DNA sequence for genomic coordinates or gene/transcript ID',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: 'Genomic region (chr:start-end) or feature ID',
        },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        format: {
          type: 'string',
          enum: ['json', 'fasta'],
          description: 'Output format (default: fasta)',
        },
        mask: {
          type: 'string',
          enum: ['hard', 'soft'],
          description: 'Repeat masking type (optional)',
        },
        multiple_sequences: {
          type: 'boolean',
          description: 'Return multiple sequences if applicable (default: false)',
        },
      },
      required: ['region'],
    },
  },
  {
    name: 'get_cds_sequence',
    description: 'Get coding sequence (CDS) for a transcript',
    inputSchema: {
      type: 'object',
      properties: {
        transcript_id: { type: 'string', description: 'Ensembl transcript ID' },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        format: {
          type: 'string',
          enum: ['json', 'fasta'],
          description: 'Output format (default: fasta)',
        },
      },
      required: ['transcript_id'],
    },
  },
  {
    name: 'translate_sequence',
    description: 'Translate DNA sequence to protein sequence',
    inputSchema: {
      type: 'object',
      properties: {
        sequence: { type: 'string', description: 'DNA sequence to translate' },
        genetic_code: {
          type: 'number',
          description: 'Genetic code table (default: 1 for standard)',
          minimum: 1,
          maximum: 31,
        },
      },
      required: ['sequence'],
    },
  },
  {
    name: 'batch_sequence_fetch',
    description: 'Fetch sequences for multiple regions or features',
    inputSchema: {
      type: 'object',
      properties: {
        regions: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of regions or feature IDs (max 50)',
          minItems: 1,
          maxItems: 50,
        },
        species: { type: 'string', description: 'Species name (default: homo_sapiens)' },
        format: {
          type: 'string',
          enum: ['json', 'fasta'],
          description: 'Output format (default: fasta)',
        },
      },
      required: ['regions'],
    },
  },
];

// ── Handlers ────────────────────────────────────────────────────────────────

async function fetchSingleSequence(args: {
  region: string;
  species?: string;
  format?: string;
  mask?: string;
  multiple_sequences?: boolean;
}) {
  const species = getDefaultSpecies(args.species);
  const region = formatGenomicRegion(args.region);

  let endpoint: string;
  const params: Record<string, unknown> = {};

  if (region.startsWith('ENS')) {
    endpoint = `/sequence/id/${region}`;
    params.type = 'genomic';
  } else {
    endpoint = `/sequence/region/${species}/${region}`;
  }

  if (args.mask) {
    params.mask = args.mask;
  }
  if (args.multiple_sequences) {
    params.multiple_sequences = 1;
  }

  const response = await getClient().get(endpoint, { params });
  return response.data;
}

async function handleGetSequence(args: Record<string, unknown>) {
  if (!isValidSequenceArgs(args)) {
    throw new Error('Invalid sequence arguments');
  }
  return fetchSingleSequence(args);
}

async function handleGetCdsSequence(args: Record<string, unknown>) {
  if (!isValidCdsArgs(args)) {
    throw new Error('Invalid CDS sequence arguments');
  }

  const species = getDefaultSpecies(args.species);

  const response = await getClient().get(`/sequence/id/${args.transcript_id}`, {
    params: { type: 'cds', species },
  });

  return response.data;
}

async function handleTranslateSequence(args: Record<string, unknown>) {
  if (!isValidTranslateArgs(args)) {
    throw new Error('Invalid translate sequence arguments');
  }

  const geneticCode = args.genetic_code || 1;

  const codonTable: Record<string, string> = {
    TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
    TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
    TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
    TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
    CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
    CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
    CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
    CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
    ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
    ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
    AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
    AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
    GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
    GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
    GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
    GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
  };

  const sequence = args.sequence.toUpperCase().replace(/[^ATCG]/g, '');
  let protein = '';

  for (let i = 0; i < sequence.length - 2; i += 3) {
    const codon = sequence.substring(i, i + 3);
    if (codon.length === 3) {
      protein += codonTable[codon] || 'X';
    }
  }

  return {
    input_sequence: args.sequence,
    cleaned_sequence: sequence,
    protein_sequence: protein,
    genetic_code: geneticCode,
    length: protein.length,
  };
}

async function handleBatchSequenceFetch(args: Record<string, unknown>) {
  if (!isValidBatchSequenceArgs(args)) {
    throw new Error('Invalid batch sequence fetch arguments');
  }

  const species = getDefaultSpecies(args.species);
  const format = args.format || 'fasta';
  const results = [];

  const context = getToolCallContext();

  for (const [index, region] of args.regions.entries()) {
    // Regions share the tool-call deadline: once it is gone, don't send the rest.
    if (context && context.remainingMs() <= 0) {
      for (const skipped of args.regions.slice(index)) {
        results.push({ region: skipped, success: false, skipped: 'deadline' });
      }
      break;
    }
    try {
      const data = await fetchSingleSequence({ region, species, format });
      results.push({ region, success: true, data });
    } catch (error) {
      results.push({
        region,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { batch_results: results };
}

// ── Export ───────────────────────────────────────────────────────────────────

export const handlers: Record<string, ToolHandler> = {
  get_sequence: handleGetSequence,
  get_cds_sequence: handleGetCdsSequence,
  translate_sequence: handleTranslateSequence,
  batch_sequence_fetch: handleBatchSequenceFetch,
};
