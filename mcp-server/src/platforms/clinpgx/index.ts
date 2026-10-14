import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PlatformModule, ToolHandler } from '../../types.js';
import { initializeClient, closeClient, getClient } from './client.js';
import * as tools from './tools/index.js';

const TOOLS: Tool[] = [
  {
    name: 'search_genes',
    description: 'Search for pharmacogenes by name or symbol in PharmGKB',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Gene name or symbol to search for (e.g., CYP2D6, TPMT)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_gene_info',
    description: 'Get detailed pharmacogenomic information about a specific gene',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol (e.g., CYP2D6, CYP2C19, TPMT)',
        },
      },
      required: ['gene'],
    },
  },
  {
    name: 'get_gene_pathways',
    description: 'Get pharmacokinetic/pharmacodynamic pathways associated with a gene',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol',
        },
      },
      required: ['gene'],
    },
  },

  {
    name: 'search_drugs',
    description: 'Search for drugs with pharmacogenomic information in PharmGKB',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Drug name to search for',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_drug_info',
    description: 'Get detailed pharmacogenomic information about a specific drug',
    inputSchema: {
      type: 'object' as const,
      properties: {
        drug: {
          type: 'string',
          description: 'Drug name',
        },
      },
      required: ['drug'],
    },
  },
  {
    name: 'get_drug_labels',
    description: 'Get FDA/EMA drug labels with pharmacogenomic information',
    inputSchema: {
      type: 'object' as const,
      properties: {
        drug: {
          type: 'string',
          description: 'Drug name',
        },
      },
      required: ['drug'],
    },
  },

  {
    name: 'search_variants',
    description: 'Search for pharmacogenomic variants',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Variant name, rsID, or gene symbol to search',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_variant_info',
    description: 'Get information about a specific pharmacogenomic variant',
    inputSchema: {
      type: 'object' as const,
      properties: {
        variantId: {
          type: 'string',
          description: 'Variant ID or rsID',
        },
      },
      required: ['variantId'],
    },
  },
  {
    name: 'get_variant_annotations',
    description: 'Get clinical annotations for a specific variant',
    inputSchema: {
      type: 'object' as const,
      properties: {
        variantId: {
          type: 'string',
          description: 'Variant ID or rsID',
        },
      },
      required: ['variantId'],
    },
  },
  {
    name: 'get_star_alleles',
    description: 'Get star allele definitions for a gene (e.g., CYP2D6*1, *2, etc.)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol (e.g., CYP2D6, CYP2C19)',
        },
      },
      required: ['gene'],
    },
  },

  {
    name: 'get_clinical_annotations',
    description: 'Get clinical annotations for a gene or drug showing drug response associations',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol (required if drug not provided)',
        },
        drug: {
          type: 'string',
          description: 'Drug name (required if gene not provided)',
        },
      },
    },
  },
  {
    name: 'get_drug_gene_interactions',
    description: 'Get all drug-gene interactions for a specific gene',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol',
        },
      },
      required: ['gene'],
    },
  },
  {
    name: 'get_annotations_by_evidence',
    description: 'Get clinical annotations filtered by minimum evidence level (1A, 1B, 2A, 2B, 3, 4)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol',
        },
        minLevel: {
          type: 'string',
          description: 'Minimum evidence level (1A=highest, 4=lowest)',
          enum: ['1A', '1B', '2A', '2B', '3', '4'],
        },
      },
      required: ['gene'],
    },
  },

  {
    name: 'get_dosing_guidelines',
    description: 'Get CPIC/DPWG dosing guidelines for a gene or drug',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol (required if drug not provided)',
        },
        drug: {
          type: 'string',
          description: 'Drug name (required if gene not provided)',
        },
        source: {
          type: 'string',
          description: 'Guideline source filter',
          enum: ['CPIC', 'DPWG'],
        },
      },
    },
  },
  {
    name: 'get_guidelines_for_pair',
    description: 'Get all guidelines and labels for a specific drug-gene pair',
    inputSchema: {
      type: 'object' as const,
      properties: {
        drug: {
          type: 'string',
          description: 'Drug name',
        },
        gene: {
          type: 'string',
          description: 'Gene symbol',
        },
      },
      required: ['drug', 'gene'],
    },
  },
  {
    name: 'get_actionable_pairs',
    description: 'Get actionable drug-gene pairs (those with dosing guidelines) for a gene',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol',
        },
      },
      required: ['gene'],
    },
  },

  {
    name: 'get_pathways',
    description: 'Get pharmacokinetic/pharmacodynamic pathways',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query for pathways',
        },
      },
    },
  },

  {
    name: 'get_database_stats',
    description: 'Get PharmGKB database statistics',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  search_genes: async (args) => {
    return tools.searchGenes(
      args.query as string,
      args.maxResults as number | undefined
    );
  },
  get_gene_info: async (args) => {
    return tools.getGeneInfo(args.gene as string);
  },
  get_gene_pathways: async (args) => {
    return tools.getGenePathways(args.gene as string);
  },

  search_drugs: async (args) => {
    return tools.searchDrugs(
      args.query as string,
      args.maxResults as number | undefined
    );
  },
  get_drug_info: async (args) => {
    return tools.getDrugInfo(args.drug as string);
  },
  get_drug_labels: async (args) => {
    return tools.getDrugLabels(args.drug as string);
  },

  search_variants: async (args) => {
    return tools.searchVariants(
      args.query as string,
      args.maxResults as number | undefined
    );
  },
  get_variant_info: async (args) => {
    return tools.getVariantInfo(args.variantId as string);
  },
  get_variant_annotations: async (args) => {
    return tools.getVariantAnnotations(args.variantId as string);
  },
  get_star_alleles: async (args) => {
    return tools.getStarAlleles(args.gene as string);
  },

  get_clinical_annotations: async (args) => {
    const gene = args.gene as string | undefined;
    const drug = args.drug as string | undefined;

    if (gene && drug) {
      return tools.getDrugGeneAnnotations(drug, gene);
    } else if (gene) {
      return tools.getClinicalAnnotationsForGene(gene);
    } else if (drug) {
      return tools.getClinicalAnnotationsForDrug(drug);
    } else {
      throw new Error('Either gene or drug must be provided');
    }
  },
  get_drug_gene_interactions: async (args) => {
    return tools.getDrugGeneInteractions(args.gene as string);
  },
  get_annotations_by_evidence: async (args) => {
    return tools.getAnnotationsByEvidenceLevel(
      args.gene as string,
      args.minLevel as string | undefined
    );
  },

  get_dosing_guidelines: async (args) => {
    const gene = args.gene as string | undefined;
    const drug = args.drug as string | undefined;
    const source = args.source as 'CPIC' | 'DPWG' | undefined;

    if (gene && source) {
      return tools.getGuidelinesBySource(gene, source);
    } else if (gene) {
      return tools.getDosingGuidelinesForGene(gene);
    } else if (drug) {
      return tools.getDosingGuidelinesForDrug(drug);
    } else {
      throw new Error('Either gene or drug must be provided');
    }
  },
  get_guidelines_for_pair: async (args) => {
    return tools.getGuidelinesForDrugGenePair(
      args.drug as string,
      args.gene as string
    );
  },
  get_actionable_pairs: async (args) => {
    return tools.getActionablePairs(args.gene as string);
  },

  get_pathways: async (args) => {
    const client = getClient();
    return client.getPathways(args.query as string | undefined);
  },

  get_database_stats: async () => {
    const client = getClient();
    return client.getDatabaseStats();
  },
};

export const platform: PlatformModule = {
  name: 'clinpgx',
  tools: TOOLS,
  handlers,

  init(_env: Record<string, string | undefined>): void {
    initializeClient();
  },

  cleanup(): void {
    closeClient();
  },
};
