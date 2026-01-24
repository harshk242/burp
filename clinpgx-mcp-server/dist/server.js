// ClinPGx MCP Server Implementation
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { initializeClient, closeClient, getClient } from './client.js';
import * as tools from './tools/index.js';
// Tool definitions
const TOOLS = [
    // Gene tools
    {
        name: 'search_genes',
        description: 'Search for pharmacogenes by name or symbol in PharmGKB',
        inputSchema: {
            type: 'object',
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
            type: 'object',
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
            type: 'object',
            properties: {
                gene: {
                    type: 'string',
                    description: 'Gene symbol',
                },
            },
            required: ['gene'],
        },
    },
    // Drug tools
    {
        name: 'search_drugs',
        description: 'Search for drugs with pharmacogenomic information in PharmGKB',
        inputSchema: {
            type: 'object',
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
            type: 'object',
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
            type: 'object',
            properties: {
                drug: {
                    type: 'string',
                    description: 'Drug name',
                },
            },
            required: ['drug'],
        },
    },
    // Variant tools
    {
        name: 'search_variants',
        description: 'Search for pharmacogenomic variants',
        inputSchema: {
            type: 'object',
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
            type: 'object',
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
            type: 'object',
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
            type: 'object',
            properties: {
                gene: {
                    type: 'string',
                    description: 'Gene symbol (e.g., CYP2D6, CYP2C19)',
                },
            },
            required: ['gene'],
        },
    },
    // Clinical annotation tools
    {
        name: 'get_clinical_annotations',
        description: 'Get clinical annotations for a gene or drug showing drug response associations',
        inputSchema: {
            type: 'object',
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
            type: 'object',
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
            type: 'object',
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
    // Dosing guideline tools
    {
        name: 'get_dosing_guidelines',
        description: 'Get CPIC/DPWG dosing guidelines for a gene or drug',
        inputSchema: {
            type: 'object',
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
            type: 'object',
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
            type: 'object',
            properties: {
                gene: {
                    type: 'string',
                    description: 'Gene symbol',
                },
            },
            required: ['gene'],
        },
    },
    // Pathway tools
    {
        name: 'get_pathways',
        description: 'Get pharmacokinetic/pharmacodynamic pathways',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Optional search query for pathways',
                },
            },
        },
    },
    // Database info
    {
        name: 'get_database_stats',
        description: 'Get PharmGKB database statistics',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
// Tool handlers
const toolHandlers = {
    // Gene tools
    search_genes: async (args) => {
        return tools.searchGenes(args.query, args.maxResults);
    },
    get_gene_info: async (args) => {
        return tools.getGeneInfo(args.gene);
    },
    get_gene_pathways: async (args) => {
        return tools.getGenePathways(args.gene);
    },
    // Drug tools
    search_drugs: async (args) => {
        return tools.searchDrugs(args.query, args.maxResults);
    },
    get_drug_info: async (args) => {
        return tools.getDrugInfo(args.drug);
    },
    get_drug_labels: async (args) => {
        return tools.getDrugLabels(args.drug);
    },
    // Variant tools
    search_variants: async (args) => {
        return tools.searchVariants(args.query, args.maxResults);
    },
    get_variant_info: async (args) => {
        return tools.getVariantInfo(args.variantId);
    },
    get_variant_annotations: async (args) => {
        return tools.getVariantAnnotations(args.variantId);
    },
    get_star_alleles: async (args) => {
        return tools.getStarAlleles(args.gene);
    },
    // Clinical annotation tools
    get_clinical_annotations: async (args) => {
        const gene = args.gene;
        const drug = args.drug;
        if (gene && drug) {
            return tools.getDrugGeneAnnotations(drug, gene);
        }
        else if (gene) {
            return tools.getClinicalAnnotationsForGene(gene);
        }
        else if (drug) {
            return tools.getClinicalAnnotationsForDrug(drug);
        }
        else {
            throw new Error('Either gene or drug must be provided');
        }
    },
    get_drug_gene_interactions: async (args) => {
        return tools.getDrugGeneInteractions(args.gene);
    },
    get_annotations_by_evidence: async (args) => {
        return tools.getAnnotationsByEvidenceLevel(args.gene, args.minLevel);
    },
    // Dosing guideline tools
    get_dosing_guidelines: async (args) => {
        const gene = args.gene;
        const drug = args.drug;
        const source = args.source;
        if (gene && source) {
            return tools.getGuidelinesBySource(gene, source);
        }
        else if (gene) {
            return tools.getDosingGuidelinesForGene(gene);
        }
        else if (drug) {
            return tools.getDosingGuidelinesForDrug(drug);
        }
        else {
            throw new Error('Either gene or drug must be provided');
        }
    },
    get_guidelines_for_pair: async (args) => {
        return tools.getGuidelinesForDrugGenePair(args.drug, args.gene);
    },
    get_actionable_pairs: async (args) => {
        return tools.getActionablePairs(args.gene);
    },
    // Pathway tools
    get_pathways: async (args) => {
        const client = getClient();
        return client.getPathways(args.query);
    },
    // Database stats
    get_database_stats: async () => {
        const client = getClient();
        return client.getDatabaseStats();
    },
};
/**
 * Create the MCP server
 */
function createServer() {
    const server = new Server({
        name: 'clinpgx-mcp-server',
        version: '1.0.0',
    }, {
        capabilities: {
            tools: {},
        },
    });
    // Handle list tools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOLS };
    });
    // Handle call tool request
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const handler = toolHandlers[name];
        if (!handler) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Unknown tool: ${name}`,
                    },
                ],
                isError: true,
            };
        }
        try {
            const result = await handler(args);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    });
    return server;
}
/**
 * Run the server
 */
export async function runServer() {
    // Initialize client
    initializeClient();
    const server = createServer();
    const transport = new StdioServerTransport();
    // Handle shutdown
    const cleanup = () => {
        closeClient();
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    await server.connect(transport);
}
//# sourceMappingURL=server.js.map