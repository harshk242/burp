import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PlatformModule, ToolHandler } from '../../types.js';
import { initializeClient, closeClient } from './client.js';
import * as tools from './tools/index.js';
import { optionalNumber, optionalString, requireNumber, requireString, requireStringArray } from '../../shared/args.js';

const TOOLS: Tool[] = [
  {
    name: 'search_variants_by_gene',
    description: 'Search ClinVar for variants in a specific gene. Returns variant IDs and summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol (e.g., BRCA1, TP53)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20,
        },
        clinical_significance: {
          type: 'string',
          description: 'Filter by clinical significance (e.g., pathogenic, benign)',
          enum: ['pathogenic', 'likely pathogenic', 'uncertain significance', 'likely benign', 'benign'],
        },
      },
      required: ['gene'],
    },
  },
  {
    name: 'get_variant_info',
    description: 'Get basic variant information by ClinVar variation ID.',
    inputSchema: {
      type: 'object',
      properties: {
        variation_id: {
          type: 'string',
          description: 'ClinVar variation ID (numeric)',
        },
      },
      required: ['variation_id'],
    },
  },
  {
    name: 'get_clinical_significance',
    description: 'Get detailed clinical significance information for a variant, including all submissions.',
    inputSchema: {
      type: 'object',
      properties: {
        variation_id: {
          type: 'string',
          description: 'ClinVar variation ID',
        },
      },
      required: ['variation_id'],
    },
  },
  {
    name: 'search_by_condition',
    description: 'Search ClinVar for variants associated with a condition or disease.',
    inputSchema: {
      type: 'object',
      properties: {
        condition: {
          type: 'string',
          description: 'Condition or disease name',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20,
        },
        clinical_significance: {
          type: 'string',
          description: 'Filter by clinical significance',
        },
      },
      required: ['condition'],
    },
  },
  {
    name: 'lookup_by_coordinates',
    description: 'Find variants at 1-based, inclusive GRCh38 genomic coordinates. GRCh37 coordinates must be lifted over before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        chromosome: {
          type: 'string',
          description: 'Chromosome number (e.g., 1, X, Y)',
        },
        start: {
          type: 'number',
          description: 'Start position on GRCh38 (1-based)',
        },
        stop: {
          type: 'number',
          description: 'Stop position on GRCh38 (inclusive; optional for range queries)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20,
        },
      },
      required: ['chromosome', 'start'],
    },
  },
  {
    name: 'get_variant_submissions',
    description: 'Get all submissions for a variant, including submitter details and interpretations.',
    inputSchema: {
      type: 'object',
      properties: {
        variation_id: {
          type: 'string',
          description: 'ClinVar variation ID',
        },
      },
      required: ['variation_id'],
    },
  },
  {
    name: 'search_by_molecular_consequence',
    description: 'Search variants by molecular consequence type.',
    inputSchema: {
      type: 'object',
      properties: {
        consequence: {
          type: 'string',
          description: 'Molecular consequence type',
          enum: ['missense variant', 'nonsense', 'frameshift variant', 'splice site variant', 'synonymous variant'],
        },
        gene: {
          type: 'string',
          description: 'Optional gene filter',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20,
        },
      },
      required: ['consequence'],
    },
  },
  {
    name: 'get_vcv_record',
    description: 'Get full VCV (Variation) record with complete details.',
    inputSchema: {
      type: 'object',
      properties: {
        variation_id: {
          type: 'string',
          description: 'ClinVar variation ID',
        },
      },
      required: ['variation_id'],
    },
  },
  {
    name: 'batch_variant_lookup',
    description: 'Lookup multiple variants by their variation IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        variation_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ClinVar variation IDs',
        },
      },
      required: ['variation_ids'],
    },
  },
  {
    name: 'get_variant_frequency',
    description: 'Get allele frequency data reported by ClinVar ESummary, including source and minor allele when provided.',
    inputSchema: {
      type: 'object',
      properties: {
        variation_id: {
          type: 'string',
          description: 'ClinVar variation ID',
        },
      },
      required: ['variation_id'],
    },
  },
  {
    name: 'search_by_review_status',
    description: 'Search variants by review status quality.',
    inputSchema: {
      type: 'object',
      properties: {
        review_status: {
          type: 'string',
          description: 'Review status',
          enum: [
            'practice guideline',
            'reviewed by expert panel',
            'criteria provided, multiple submitters, no conflicts',
            'criteria provided, single submitter',
          ],
        },
        gene: {
          type: 'string',
          description: 'Optional gene filter',
        },
        clinical_significance: {
          type: 'string',
          description: 'Optional clinical significance filter',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20,
        },
      },
      required: ['review_status'],
    },
  },
  {
    name: 'lookup_by_rsid',
    description: 'Find ClinVar variants by dbSNP rsID.',
    inputSchema: {
      type: 'object',
      properties: {
        rs_id: {
          type: 'string',
          description: 'dbSNP rsID (e.g., rs123456)',
        },
      },
      required: ['rs_id'],
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  search_variants_by_gene: async (args) => {
    return tools.searchVariantsByGene(requireString(args, 'gene'), {
      maxResults: optionalNumber(args, 'max_results'),
      clinicalSignificance: optionalString(args, 'clinical_significance'),
    });
  },

  get_variant_info: async (args) => {
    return tools.getVariantInfo(requireString(args, 'variation_id'));
  },

  get_clinical_significance: async (args) => {
    return tools.getClinicalSignificance(requireString(args, 'variation_id'));
  },

  search_by_condition: async (args) => {
    return tools.searchByCondition(requireString(args, 'condition'), {
      maxResults: optionalNumber(args, 'max_results'),
      clinicalSignificance: optionalString(args, 'clinical_significance'),
    });
  },

  lookup_by_coordinates: async (args) => {
    return tools.lookupByCoordinates(
      requireString(args, 'chromosome'),
      requireNumber(args, 'start'),
      optionalNumber(args, 'stop'),
      { maxResults: optionalNumber(args, 'max_results') }
    );
  },

  get_variant_submissions: async (args) => {
    return tools.getVariantSubmissions(requireString(args, 'variation_id'));
  },

  search_by_molecular_consequence: async (args) => {
    return tools.searchByMolecularConsequence(requireString(args, 'consequence'), {
      gene: optionalString(args, 'gene'),
      maxResults: optionalNumber(args, 'max_results'),
    });
  },

  get_vcv_record: async (args) => {
    return tools.getVCVRecord(requireString(args, 'variation_id'));
  },

  batch_variant_lookup: async (args) => {
    return tools.batchVariantLookup(requireStringArray(args, 'variation_ids'));
  },

  get_variant_frequency: async (args) => {
    return tools.getVariantFrequency(requireString(args, 'variation_id'));
  },

  search_by_review_status: async (args) => {
    return tools.searchByReviewStatus(requireString(args, 'review_status'), {
      gene: optionalString(args, 'gene'),
      clinicalSignificance: optionalString(args, 'clinical_significance'),
      maxResults: optionalNumber(args, 'max_results'),
    });
  },

  lookup_by_rsid: async (args) => {
    return tools.lookupByRsId(requireString(args, 'rs_id'));
  },
};

export const platform: PlatformModule = {
  name: 'clinvar',
  tools: TOOLS,
  handlers,

  init(env: Record<string, string | undefined>): void {
    initializeClient({
      apiKey: env.NCBI_API_KEY,
    });
  },

  cleanup(): void {
    closeClient();
  },
};
