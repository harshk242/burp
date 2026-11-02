import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  {
    name: 'search_pathways',
    description: 'Search for biological pathways by name, description, or keywords',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (pathway name, process, keywords)' },
        type: {
          type: 'string',
          enum: ['pathway', 'reaction', 'protein', 'complex', 'disease'],
          description: 'Type of entity to search for (default: pathway)',
        },
        size: {
          type: 'number',
          description: 'Number of results to return (1-100, default: 20)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_pathway_details',
    description: 'Get comprehensive information about a specific pathway',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Reactome pathway stable identifier (e.g., R-HSA-68886)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'find_pathways_by_gene',
    description: 'Find all pathways containing a specific gene or protein',
    inputSchema: {
      type: 'object',
      properties: {
        gene: {
          type: 'string',
          description: 'Gene symbol or UniProt ID (e.g., BRCA1, P04637)',
        },
        species: {
          type: 'string',
          description: 'Species name or taxon ID (default: Homo sapiens)',
        },
      },
      required: ['gene'],
    },
  },
  {
    name: 'find_pathways_by_disease',
    description: 'Find disease-associated pathways and mechanisms',
    inputSchema: {
      type: 'object',
      properties: {
        disease: { type: 'string', description: 'Disease name or DOID identifier' },
        size: {
          type: 'number',
          description: 'Number of pathways to return (1-100, default: 25)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['disease'],
    },
  },
  {
    name: 'get_pathway_hierarchy',
    description: 'Get hierarchical structure and parent/child relationships for a pathway',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Reactome pathway stable identifier' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_pathway_participants',
    description: 'Get all molecules (proteins, genes, compounds) participating in a pathway',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Reactome pathway stable identifier' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_pathway_reactions',
    description: 'Get all biochemical reactions within a pathway',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Reactome pathway stable identifier' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_protein_interactions',
    description: 'Get protein-protein interactions within pathways',
    inputSchema: {
      type: 'object',
      properties: {
        pathwayId: { type: 'string', description: 'Reactome pathway stable identifier' },
        interactionType: {
          type: 'string',
          enum: ['protein-protein', 'regulatory', 'catalysis', 'all'],
          description: 'Type of interactions to retrieve (default: all)',
        },
      },
      required: ['pathwayId'],
    },
  },
];
