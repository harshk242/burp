#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';

// UniProt API interfaces
interface ProteinSearchResult {
  primaryAccession: string;
  uniProtkbId: string;
  entryType: string;
  organism: {
    scientificName: string;
    taxonId: number;
  };
  proteinDescription: {
    recommendedName?: {
      fullName: {
        value: string;
      };
    };
    submissionNames?: Array<{
      fullName: {
        value: string;
      };
    }>;
  };
  genes?: Array<{
    geneName: {
      value: string;
    };
  }>;
}

interface ProteinInfo {
  primaryAccession: string;
  uniProtkbId: string;
  entryType: string;
  organism: {
    scientificName: string;
    commonName?: string;
    taxonId: number;
  };
  proteinDescription: any;
  genes?: any[];
  comments?: any[];
  features?: any[];
  keywords?: any[];
  references?: any[];
  sequence: {
    value: string;
    length: number;
    molWeight: number;
  };
}

// Type guards and validation functions
const isValidSearchArgs = (
  args: any
): args is { query: string; organism?: string; size?: number; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.query === 'string' &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.size === undefined || (typeof args.size === 'number' && args.size > 0 && args.size <= 500)) &&
    (args.format === undefined || ['json', 'tsv', 'fasta', 'xml'].includes(args.format))
  );
};

const isValidProteinInfoArgs = (
  args: any
): args is { accession: string; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.accession === 'string' &&
    args.accession.length > 0 &&
    (args.format === undefined || ['json', 'tsv', 'fasta', 'xml'].includes(args.format))
  );
};

const isValidGeneSearchArgs = (
  args: any
): args is { gene: string; organism?: string; size?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.gene === 'string' &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.size === undefined || (typeof args.size === 'number' && args.size > 0 && args.size <= 500))
  );
};

const isValidSequenceArgs = (
  args: any
): args is { accession: string; format?: 'fasta' | 'json' } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.accession === 'string' &&
    args.accession.length > 0 &&
    (args.format === undefined || ['fasta', 'json'].includes(args.format))
  );
};

// Additional validation functions for new tools
const isValidCompareProteinsArgs = (
  args: any
): args is { accessions: string[]; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    Array.isArray(args.accessions) &&
    args.accessions.length > 1 &&
    args.accessions.length <= 10 &&
    args.accessions.every((acc: any) => typeof acc === 'string' && acc.length > 0) &&
    (args.format === undefined || ['json', 'tsv'].includes(args.format))
  );
};

const isValidHomologArgs = (
  args: any
): args is { accession: string; organism?: string; size?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.accession === 'string' &&
    args.accession.length > 0 &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.size === undefined || (typeof args.size === 'number' && args.size > 0 && args.size <= 100))
  );
};

const isValidBatchLookupArgs = (
  args: any
): args is { accessions: string[]; format?: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    Array.isArray(args.accessions) &&
    args.accessions.length > 0 &&
    args.accessions.length <= 100 &&
    args.accessions.every((acc: any) => typeof acc === 'string' && acc.length > 0) &&
    (args.format === undefined || ['json', 'tsv', 'fasta'].includes(args.format))
  );
};

const isValidAdvancedSearchArgs = (
  args: any
): args is {
    query?: string;
    organism?: string;
    minLength?: number;
    maxLength?: number;
    minMass?: number;
    maxMass?: number;
    keywords?: string[];
    size?: number
  } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.minLength === undefined || (typeof args.minLength === 'number' && args.minLength > 0)) &&
    (args.maxLength === undefined || (typeof args.maxLength === 'number' && args.maxLength > 0)) &&
    (args.minMass === undefined || (typeof args.minMass === 'number' && args.minMass > 0)) &&
    (args.maxMass === undefined || (typeof args.maxMass === 'number' && args.maxMass > 0)) &&
    (args.keywords === undefined || (Array.isArray(args.keywords) && args.keywords.every((k: any) => typeof k === 'string'))) &&
    (args.size === undefined || (typeof args.size === 'number' && args.size > 0 && args.size <= 500))
  );
};

const isValidFunctionSearchArgs = (
  args: any
): args is { goTerm?: string; function?: string; organism?: string; size?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.goTerm === undefined || typeof args.goTerm === 'string') &&
    (args.function === undefined || typeof args.function === 'string') &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.size === undefined || (typeof args.size === 'number' && args.size > 0 && args.size <= 500)) &&
    (args.goTerm !== undefined || args.function !== undefined)
  );
};

const isValidTaxonomySearchArgs = (
  args: any
): args is { taxonomyId?: number; taxonomyName?: string; size?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.taxonomyId === undefined || (typeof args.taxonomyId === 'number' && args.taxonomyId > 0)) &&
    (args.taxonomyName === undefined || typeof args.taxonomyName === 'string') &&
    (args.size === undefined || (typeof args.size === 'number' && args.size > 0 && args.size <= 500)) &&
    (args.taxonomyId !== undefined || args.taxonomyName !== undefined)
  );
};

const isValidAccessionValidateArgs = (
  args: any
): args is { accession: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.accession === 'string' &&
    args.accession.length > 0
  );
};

const isValidLocalizationSearchArgs = (
  args: any
): args is { localization: string; organism?: string; size?: number } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.localization === 'string' &&
    args.localization.length > 0 &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.size === undefined || (typeof args.size === 'number' && args.size > 0 && args.size <= 500))
  );
};

class UniProtServer {
  private server: Server;
  private apiClient: AxiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: 'uniprot-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize UniProt API client
    this.apiClient = axios.create({
      baseURL: 'https://rest.uniprot.org',
      timeout: 30000,
      headers: {
        'User-Agent': 'UniProt-MCP-Server/0.1.0',
      },
    });

    this.setupResourceHandlers();
    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupResourceHandlers() {
    // List available resource templates
    this.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async () => ({
        resourceTemplates: [
          {
            uriTemplate: 'uniprot://protein/{accession}',
            name: 'UniProt protein entry',
            mimeType: 'application/json',
            description: 'Complete protein information for a UniProt accession',
          },
          {
            uriTemplate: 'uniprot://sequence/{accession}',
            name: 'Protein sequence',
            mimeType: 'text/plain',
            description: 'FASTA format protein sequence for a UniProt accession',
          },
          {
            uriTemplate: 'uniprot://search/{query}',
            name: 'Protein search results',
            mimeType: 'application/json',
            description: 'Search results for proteins matching the query',
          },
        ],
      })
    );

    // Handle resource requests
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = request.params.uri;

        // Handle protein info requests
        const proteinMatch = uri.match(/^uniprot:\/\/protein\/([A-Z0-9]+)$/);
        if (proteinMatch) {
          const accession = proteinMatch[1];
          try {
            const response = await this.apiClient.get(`/uniprotkb/${accession}`, {
              params: { format: 'json' },
            });

            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to fetch protein ${accession}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Handle sequence requests
        const sequenceMatch = uri.match(/^uniprot:\/\/sequence\/([A-Z0-9]+)$/);
        if (sequenceMatch) {
          const accession = sequenceMatch[1];
          try {
            const response = await this.apiClient.get(`/uniprotkb/${accession}`, {
              params: { format: 'fasta' },
            });

            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'text/plain',
                  text: response.data,
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to fetch sequence for ${accession}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Handle search requests
        const searchMatch = uri.match(/^uniprot:\/\/search\/(.+)$/);
        if (searchMatch) {
          const query = decodeURIComponent(searchMatch[1]);
          try {
            const response = await this.apiClient.get('/uniprotkb/search', {
              params: {
                query: query,
                format: 'json',
                size: 25,
              },
            });

            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to search proteins: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        throw new McpError(
          ErrorCode.InvalidRequest,
          `Invalid URI format: ${uri}`
        );
      }
    );
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Original tools
        {
          name: 'search_proteins',
          description: 'Search UniProt database for proteins by name, keyword, or organism',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (protein name, keyword, or complex search)' },
              organism: { type: 'string', description: 'Organism name or taxonomy ID to filter results' },
              size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
              format: { type: 'string', enum: ['json', 'tsv', 'fasta', 'xml'], description: 'Output format (default: json)' },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_protein_info',
          description: 'Get detailed information for a specific protein by UniProt accession',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number (e.g., P04637)' },
              format: { type: 'string', enum: ['json', 'tsv', 'fasta', 'xml'], description: 'Output format (default: json)' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'search_by_gene',
          description: 'Search for proteins by gene name or symbol',
          inputSchema: {
            type: 'object',
            properties: {
              gene: { type: 'string', description: 'Gene name or symbol (e.g., BRCA1, INS)' },
              organism: { type: 'string', description: 'Organism name or taxonomy ID to filter results' },
              size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
            },
            required: ['gene'],
          },
        },
        {
          name: 'get_protein_sequence',
          description: 'Get the amino acid sequence for a protein',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
              format: { type: 'string', enum: ['fasta', 'json'], description: 'Output format (default: fasta)' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_protein_features',
          description: 'Get functional features and domains for a protein',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        // Comparative & Evolutionary Analysis Tools
        {
          name: 'compare_proteins',
          description: 'Compare multiple proteins side-by-side with sequence and feature comparison',
          inputSchema: {
            type: 'object',
            properties: {
              accessions: { type: 'array', items: { type: 'string' }, description: 'Array of UniProt accession numbers (2-10)', minItems: 2, maxItems: 10 },
              format: { type: 'string', enum: ['json', 'tsv'], description: 'Output format (default: json)' },
            },
            required: ['accessions'],
          },
        },
        {
          name: 'get_protein_homologs',
          description: 'Find homologous proteins across different species',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
              organism: { type: 'string', description: 'Target organism to find homologs in' },
              size: { type: 'number', description: 'Number of results to return (1-100, default: 25)', minimum: 1, maximum: 100 },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_protein_orthologs',
          description: 'Identify orthologous proteins for evolutionary studies',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
              organism: { type: 'string', description: 'Target organism to find orthologs in' },
              size: { type: 'number', description: 'Number of results to return (1-100, default: 25)', minimum: 1, maximum: 100 },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_phylogenetic_info',
          description: 'Retrieve evolutionary relationships and phylogenetic data',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        // Structure & Function Analysis Tools
        {
          name: 'get_protein_structure',
          description: 'Retrieve 3D structure information from PDB references',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_protein_domains_detailed',
          description: 'Enhanced domain analysis with InterPro, Pfam, and SMART annotations',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_protein_variants',
          description: 'Disease-associated variants and mutations',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'analyze_sequence_composition',
          description: 'Amino acid composition, hydrophobicity, and other sequence properties',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        // Biological Context Tools
        {
          name: 'get_protein_pathways',
          description: 'Associated biological pathways (KEGG, Reactome)',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_protein_interactions',
          description: 'Protein-protein interaction networks',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'search_by_function',
          description: 'Search proteins by GO terms or functional annotations',
          inputSchema: {
            type: 'object',
            properties: {
              goTerm: { type: 'string', description: 'Gene Ontology term (e.g., GO:0005524)' },
              function: { type: 'string', description: 'Functional description or keyword' },
              organism: { type: 'string', description: 'Organism name or taxonomy ID to filter results' },
              size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
            },
            required: [],
          },
        },
        {
          name: 'search_by_localization',
          description: 'Find proteins by subcellular localization',
          inputSchema: {
            type: 'object',
            properties: {
              localization: { type: 'string', description: 'Subcellular localization (e.g., nucleus, mitochondria)' },
              organism: { type: 'string', description: 'Organism name or taxonomy ID to filter results' },
              size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
            },
            required: ['localization'],
          },
        },
        // Batch Processing & Advanced Search
        {
          name: 'batch_protein_lookup',
          description: 'Process multiple accessions efficiently',
          inputSchema: {
            type: 'object',
            properties: {
              accessions: { type: 'array', items: { type: 'string' }, description: 'Array of UniProt accession numbers (1-100)', minItems: 1, maxItems: 100 },
              format: { type: 'string', enum: ['json', 'tsv', 'fasta'], description: 'Output format (default: json)' },
            },
            required: ['accessions'],
          },
        },
        {
          name: 'advanced_search',
          description: 'Complex queries with multiple filters (length, mass, organism, function)',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Base search query' },
              organism: { type: 'string', description: 'Organism name or taxonomy ID' },
              minLength: { type: 'number', description: 'Minimum sequence length', minimum: 1 },
              maxLength: { type: 'number', description: 'Maximum sequence length' },
              minMass: { type: 'number', description: 'Minimum molecular mass (Da)', minimum: 1 },
              maxMass: { type: 'number', description: 'Maximum molecular mass (Da)' },
              keywords: { type: 'array', items: { type: 'string' }, description: 'Array of keywords to include' },
              size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
            },
            required: [],
          },
        },
        {
          name: 'search_by_taxonomy',
          description: 'Search by detailed taxonomic classification',
          inputSchema: {
            type: 'object',
            properties: {
              taxonomyId: { type: 'number', description: 'NCBI taxonomy ID', minimum: 1 },
              taxonomyName: { type: 'string', description: 'Taxonomic name (e.g., Mammalia, Bacteria)' },
              size: { type: 'number', description: 'Number of results to return (1-500, default: 25)', minimum: 1, maximum: 500 },
            },
            required: [],
          },
        },
        // Cross-Reference & Literature Tools
        {
          name: 'get_external_references',
          description: 'Links to other databases (PDB, EMBL, RefSeq, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_literature_references',
          description: 'Associated publications and citations',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_annotation_confidence',
          description: 'Quality scores for different annotations',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
        // Export & Utility Tools
        {
          name: 'export_protein_data',
          description: 'Export data in specialized formats (GFF, GenBank, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
              format: { type: 'string', enum: ['gff', 'genbank', 'embl', 'xml'], description: 'Export format' },
            },
            required: ['accession', 'format'],
          },
        },
        {
          name: 'validate_accession',
          description: 'Check if accession numbers are valid',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number to validate' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_taxonomy_info',
          description: 'Detailed taxonomic information for organisms',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'UniProt accession number' },
            },
            required: ['accession'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        // Original tools
        case 'search_proteins':
          return this.handleSearchProteins(args);
        case 'get_protein_info':
          return this.handleGetProteinInfo(args);
        case 'search_by_gene':
          return this.handleSearchByGene(args);
        case 'get_protein_sequence':
          return this.handleGetProteinSequence(args);
        case 'get_protein_features':
          return this.handleGetProteinFeatures(args);
        // Comparative & Evolutionary Analysis Tools
        case 'compare_proteins':
          return this.handleCompareProteins(args);
        case 'get_protein_homologs':
          return this.handleGetProteinHomologs(args);
        case 'get_protein_orthologs':
          return this.handleGetProteinOrthologs(args);
        case 'get_phylogenetic_info':
          return this.handleGetPhylogeneticInfo(args);
        // Structure & Function Analysis Tools
        case 'get_protein_structure':
          return this.handleGetProteinStructure(args);
        case 'get_protein_domains_detailed':
          return this.handleGetProteinDomainsDetailed(args);
        case 'get_protein_variants':
          return this.handleGetProteinVariants(args);
        case 'analyze_sequence_composition':
          return this.handleAnalyzeSequenceComposition(args);
        // Biological Context Tools
        case 'get_protein_pathways':
          return this.handleGetProteinPathways(args);
        case 'get_protein_interactions':
          return this.handleGetProteinInteractions(args);
        case 'search_by_function':
          return this.handleSearchByFunction(args);
        case 'search_by_localization':
          return this.handleSearchByLocalization(args);
        // Batch Processing & Advanced Search
        case 'batch_protein_lookup':
          return this.handleBatchProteinLookup(args);
        case 'advanced_search':
          return this.handleAdvancedSearch(args);
        case 'search_by_taxonomy':
          return this.handleSearchByTaxonomy(args);
        // Cross-Reference & Literature Tools
        case 'get_external_references':
          return this.handleGetExternalReferences(args);
        case 'get_literature_references':
          return this.handleGetLiteratureReferences(args);
        case 'get_annotation_confidence':
          return this.handleGetAnnotationConfidence(args);
        // Export & Utility Tools
        case 'export_protein_data':
          return this.handleExportProteinData(args);
        case 'validate_accession':
          return this.handleValidateAccession(args);
        case 'get_taxonomy_info':
          return this.handleGetTaxonomyInfo(args);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
          );
      }
    });
  }

  private async handleSearchProteins(args: any) {
    if (!isValidSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid search arguments');
    }

    try {
      let query = args.query;
      if (args.organism) {
        query += ` AND organism_name:"${args.organism}"`;
      }

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: args.format || 'json',
          size: args.size || 25,
        },
      });

            return {
              content: [
                {
                  type: 'text',
                  text: typeof response.data === 'object'
                    ? JSON.stringify(response.data, null, 2)
                    : String(response.data),
                },
              ],
            };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching proteins: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinInfo(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid protein info arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: {
          format: args.format || 'json',
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: args.format === 'json'
              ? JSON.stringify(response.data, null, 2)
              : String(response.data),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching protein info: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSearchByGene(args: any) {
    if (!isValidGeneSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid gene search arguments');
    }

    try {
      let query = `gene:"${args.gene}"`;
      if (args.organism) {
        query += ` AND organism_name:"${args.organism}"`;
      }

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: 'json',
          size: args.size || 25,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching by gene: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinSequence(args: any) {
    if (!isValidSequenceArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sequence arguments');
    }

    try {
      const format = args.format || 'fasta';
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format },
      });

      return {
        content: [
          {
            type: 'text',
            text: format === 'json'
              ? JSON.stringify(response.data, null, 2)
              : String(response.data),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching sequence: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinFeatures(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid protein features arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      // Extract features and domains from the response
      const protein = response.data;
      const features = {
        accession: protein.primaryAccession,
        name: protein.uniProtkbId,
        features: protein.features || [],
        comments: protein.comments || [],
        keywords: protein.keywords || [],
        domains: protein.features?.filter((f: any) => f.type === 'Domain') || [],
        activeSites: protein.features?.filter((f: any) => f.type === 'Active site') || [],
        bindingSites: protein.features?.filter((f: any) => f.type === 'Binding site') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(features, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching protein features: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Comparative & Evolutionary Analysis Tools
  private async handleCompareProteins(args: any) {
    if (!isValidCompareProteinsArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid compare proteins arguments');
    }

    try {
      const comparisons = [];
      for (const accession of args.accessions) {
        const response = await this.apiClient.get(`/uniprotkb/${accession}`, {
          params: { format: 'json' },
        });
        const protein = response.data;
        comparisons.push({
          accession: protein.primaryAccession,
          name: protein.uniProtkbId,
          organism: protein.organism?.scientificName,
          length: protein.sequence?.length,
          mass: protein.sequence?.molWeight,
          features: protein.features?.length || 0,
          domains: protein.features?.filter((f: any) => f.type === 'Domain').length || 0,
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ comparison: comparisons }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error comparing proteins: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinHomologs(args: any) {
    if (!isValidHomologArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid homolog search arguments');
    }

    try {
      // Get the protein info first to build a homology search
      const proteinResponse = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });
      const protein = proteinResponse.data;

      // Build search query for homologs
      let query = `reviewed:true`;
      if (protein.proteinDescription?.recommendedName?.fullName?.value) {
        query += ` AND (${protein.proteinDescription.recommendedName.fullName.value})`;
      }
      if (args.organism) {
        query += ` AND organism_name:"${args.organism}"`;
      }
      query += ` NOT accession:"${args.accession}"`;

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: 'json',
          size: args.size || 25,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error finding homologs: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinOrthologs(args: any) {
    if (!isValidHomologArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid ortholog search arguments');
    }

    try {
      // Get the protein info first
      const proteinResponse = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });
      const protein = proteinResponse.data;

      // Build ortholog search (similar function, different organism)
      let query = `reviewed:true`;
      if (protein.genes?.[0]?.geneName?.value) {
        query += ` AND gene:"${protein.genes[0].geneName.value}"`;
      }
      if (args.organism) {
        query += ` AND organism_name:"${args.organism}"`;
      }
      query += ` NOT accession:"${args.accession}"`;

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: 'json',
          size: args.size || 25,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error finding orthologs: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetPhylogeneticInfo(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid phylogenetic info arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const phylogeneticInfo = {
        accession: protein.primaryAccession,
        organism: protein.organism,
        taxonomicLineage: protein.organism?.lineage || [],
        evolutionaryOrigin: protein.comments?.filter((c: any) => c.commentType === 'EVOLUTIONARY ORIGIN') || [],
        phylogeneticRange: protein.comments?.filter((c: any) => c.commentType === 'PHYLOGENETIC RANGE') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(phylogeneticInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching phylogenetic info: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Structure & Function Analysis Tools
  private async handleGetProteinStructure(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid protein structure arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const structureInfo = {
        accession: protein.primaryAccession,
        pdbReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'PDB') || [],
        structuralFeatures: protein.features?.filter((f: any) =>
          ['Secondary structure', 'Turn', 'Helix', 'Beta strand'].includes(f.type)
        ) || [],
        structuralComments: protein.comments?.filter((c: any) => c.commentType === 'SUBUNIT') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structureInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching protein structure: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinDomainsDetailed(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid protein domains arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const domainInfo = {
        accession: protein.primaryAccession,
        domains: protein.features?.filter((f: any) => f.type === 'Domain') || [],
        regions: protein.features?.filter((f: any) => f.type === 'Region') || [],
        repeats: protein.features?.filter((f: any) => f.type === 'Repeat') || [],
        interproReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'InterPro') || [],
        pfamReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'Pfam') || [],
        smartReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'SMART') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(domainInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching protein domains: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinVariants(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid protein variants arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const variantInfo = {
        accession: protein.primaryAccession,
        naturalVariants: protein.features?.filter((f: any) => f.type === 'Natural variant') || [],
        mutagenesisFeatures: protein.features?.filter((f: any) => f.type === 'Mutagenesis') || [],
        diseaseVariants: protein.features?.filter((f: any) =>
          f.type === 'Natural variant' && f.association?.disease
        ) || [],
        polymorphisms: protein.comments?.filter((c: any) => c.commentType === 'POLYMORPHISM') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(variantInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching protein variants: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleAnalyzeSequenceComposition(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sequence composition arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const sequence = protein.sequence?.value || '';

      // Calculate amino acid composition
      const aaCount: { [key: string]: number } = {};
      const aaFreq: { [key: string]: number } = {};

      for (const aa of sequence) {
        aaCount[aa] = (aaCount[aa] || 0) + 1;
      }

      for (const aa in aaCount) {
        aaFreq[aa] = aaCount[aa] / sequence.length;
      }

      const composition = {
        accession: protein.primaryAccession,
        sequenceLength: sequence.length,
        molecularWeight: protein.sequence?.molWeight,
        aminoAcidComposition: aaCount,
        aminoAcidFrequency: aaFreq,
        hydrophobicResidues: ['A', 'I', 'L', 'M', 'F', 'W', 'Y', 'V'].reduce((sum, aa) => sum + (aaCount[aa] || 0), 0),
        chargedResidues: ['R', 'H', 'K', 'D', 'E'].reduce((sum, aa) => sum + (aaCount[aa] || 0), 0),
        polarResidues: ['S', 'T', 'N', 'Q'].reduce((sum, aa) => sum + (aaCount[aa] || 0), 0),
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(composition, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error analyzing sequence composition: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Biological Context Tools
  private async handleGetProteinPathways(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid protein pathways arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const pathwayInfo = {
        accession: protein.primaryAccession,
        keggReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'KEGG') || [],
        reactomeReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'Reactome') || [],
        pathwayComments: protein.comments?.filter((c: any) => c.commentType === 'PATHWAY') || [],
        biologicalProcess: protein.comments?.filter((c: any) => c.commentType === 'FUNCTION') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(pathwayInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching protein pathways: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetProteinInteractions(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid protein interactions arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const interactionInfo = {
        accession: protein.primaryAccession,
        stringReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'STRING') || [],
        intactReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'IntAct') || [],
        interactionComments: protein.comments?.filter((c: any) => c.commentType === 'INTERACTION') || [],
        subunitComments: protein.comments?.filter((c: any) => c.commentType === 'SUBUNIT') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(interactionInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching protein interactions: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSearchByFunction(args: any) {
    if (!isValidFunctionSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid function search arguments');
    }

    try {
      let query = 'reviewed:true';

      if (args.goTerm) {
        query += ` AND go:"${args.goTerm}"`;
      }

      if (args.function) {
        query += ` AND (cc_function:"${args.function}" OR ft_act_site:"${args.function}")`;
      }

      if (args.organism) {
        query += ` AND organism_name:"${args.organism}"`;
      }

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: 'json',
          size: args.size || 25,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching by function: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSearchByLocalization(args: any) {
    if (!isValidLocalizationSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid localization search arguments');
    }

    try {
      let query = `reviewed:true AND cc_subcellular_location:"${args.localization}"`;

      if (args.organism) {
        query += ` AND organism_name:"${args.organism}"`;
      }

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: 'json',
          size: args.size || 25,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching by localization: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Batch Processing & Advanced Search
  private async handleBatchProteinLookup(args: any) {
    if (!isValidBatchLookupArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid batch lookup arguments');
    }

    try {
      const results = [];

      // Process in chunks to avoid API limits
      const chunkSize = 10;
      for (let i = 0; i < args.accessions.length; i += chunkSize) {
        const chunk = args.accessions.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(async (accession: string) => {
            try {
              const response = await this.apiClient.get(`/uniprotkb/${accession}`, {
                params: { format: args.format || 'json' },
              });
              return { accession, data: response.data, success: true };
            } catch (error) {
              return { accession, error: error instanceof Error ? error.message : 'Unknown error', success: false };
            }
          })
        );
        results.push(...chunkResults);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ batchResults: results }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error in batch lookup: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleAdvancedSearch(args: any) {
    if (!isValidAdvancedSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid advanced search arguments');
    }

    try {
      let query = 'reviewed:true';

      if (args.query) {
        query += ` AND (${args.query})`;
      }

      if (args.organism) {
        query += ` AND organism_name:"${args.organism}"`;
      }

      if (args.minLength || args.maxLength) {
        if (args.minLength && args.maxLength) {
          query += ` AND length:[${args.minLength} TO ${args.maxLength}]`;
        } else if (args.minLength) {
          query += ` AND length:[${args.minLength} TO *]`;
        } else if (args.maxLength) {
          query += ` AND length:[* TO ${args.maxLength}]`;
        }
      }

      if (args.minMass || args.maxMass) {
        if (args.minMass && args.maxMass) {
          query += ` AND mass:[${args.minMass} TO ${args.maxMass}]`;
        } else if (args.minMass) {
          query += ` AND mass:[${args.minMass} TO *]`;
        } else if (args.maxMass) {
          query += ` AND mass:[* TO ${args.maxMass}]`;
        }
      }

      if (args.keywords) {
        for (const keyword of args.keywords) {
          query += ` AND keyword:"${keyword}"`;
        }
      }

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: 'json',
          size: args.size || 25,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error in advanced search: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSearchByTaxonomy(args: any) {
    if (!isValidTaxonomySearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid taxonomy search arguments');
    }

    try {
      let query = 'reviewed:true';

      if (args.taxonomyId) {
        query += ` AND taxonomy_id:"${args.taxonomyId}"`;
      }

      if (args.taxonomyName) {
        query += ` AND taxonomy_name:"${args.taxonomyName}"`;
      }

      const response = await this.apiClient.get('/uniprotkb/search', {
        params: {
          query: query,
          format: 'json',
          size: args.size || 25,
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching by taxonomy: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Cross-Reference & Literature Tools
  private async handleGetExternalReferences(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid external references arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const externalRefs = {
        accession: protein.primaryAccession,
        allReferences: protein.uniProtKBCrossReferences || [],
        pdbReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'PDB') || [],
        emblReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'EMBL') || [],
        refseqReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'RefSeq') || [],
        ensemblReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'Ensembl') || [],
        goReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'GO') || [],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(externalRefs, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching external references: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetLiteratureReferences(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid literature references arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const literatureInfo = {
        accession: protein.primaryAccession,
        references: protein.references || [],
        pubmedReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'PubMed') || [],
        citationCount: protein.references?.length || 0,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(literatureInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching literature references: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetAnnotationConfidence(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid annotation confidence arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const confidenceInfo = {
        accession: protein.primaryAccession,
        entryType: protein.entryType,
        proteinExistence: protein.proteinExistence,
        annotationScore: protein.annotationScore || 'Not available',
        evidenceCodes: protein.features?.map((f: any) => f.evidences).flat().filter(Boolean) || [],
        reviewStatus: protein.entryType === 'UniProtKB reviewed (Swiss-Prot)' ? 'Reviewed' : 'Unreviewed',
        referenceCount: protein.references?.length || 0,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(confidenceInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching annotation confidence: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Export & Utility Tools
  private async handleExportProteinData(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid export protein data arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: args.format },
      });

      return {
        content: [
          {
            type: 'text',
            text: String(response.data),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error exporting protein data: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleValidateAccession(args: any) {
    if (!isValidAccessionValidateArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid accession validation arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const validationResult = {
        accession: args.accession,
        isValid: true,
        entryType: response.data.entryType,
        primaryAccession: response.data.primaryAccession,
        exists: true,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(validationResult, null, 2),
          },
        ],
      };
    } catch (error) {
      const validationResult = {
        accession: args.accession,
        isValid: false,
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(validationResult, null, 2),
          },
        ],
      };
    }
  }

  private async handleGetTaxonomyInfo(args: any) {
    if (!isValidProteinInfoArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid taxonomy info arguments');
    }

    try {
      const response = await this.apiClient.get(`/uniprotkb/${args.accession}`, {
        params: { format: 'json' },
      });

      const protein = response.data;
      const taxonomyInfo = {
        accession: protein.primaryAccession,
        organism: protein.organism,
        taxonomyId: protein.organism?.taxonId,
        scientificName: protein.organism?.scientificName,
        commonName: protein.organism?.commonName,
        lineage: protein.organism?.lineage || [],
        taxonomicDivision: protein.organism?.lineage?.[0] || 'Unknown',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(taxonomyInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching taxonomy info: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('UniProt MCP server running on stdio');
  }
}

const server = new UniProtServer();
server.run().catch(console.error);
