// ClinVar MCP Server - Server setup and tool definitions
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { initializeClient, closeClient } from './client.js';
import * as tools from './tools/index.js';
// Tool definitions
const TOOLS = [
    // Variant lookup tools
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
        description: 'Find variants at specific genomic coordinates.',
        inputSchema: {
            type: 'object',
            properties: {
                chromosome: {
                    type: 'string',
                    description: 'Chromosome number (e.g., 1, X, Y)',
                },
                start: {
                    type: 'number',
                    description: 'Start position',
                },
                stop: {
                    type: 'number',
                    description: 'Stop position (optional, for range queries)',
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
        description: 'Get population frequency data for a variant.',
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
// Tool handlers
const toolHandlers = {
    search_variants_by_gene: async (args) => {
        return tools.searchVariantsByGene(args.gene, {
            maxResults: args.max_results,
            clinicalSignificance: args.clinical_significance,
        });
    },
    get_variant_info: async (args) => {
        return tools.getVariantInfo(args.variation_id);
    },
    get_clinical_significance: async (args) => {
        return tools.getClinicalSignificance(args.variation_id);
    },
    search_by_condition: async (args) => {
        return tools.searchByCondition(args.condition, {
            maxResults: args.max_results,
            clinicalSignificance: args.clinical_significance,
        });
    },
    lookup_by_coordinates: async (args) => {
        return tools.lookupByCoordinates(args.chromosome, args.start, args.stop, { maxResults: args.max_results });
    },
    get_variant_submissions: async (args) => {
        return tools.getVariantSubmissions(args.variation_id);
    },
    search_by_molecular_consequence: async (args) => {
        return tools.searchByMolecularConsequence(args.consequence, {
            gene: args.gene,
            maxResults: args.max_results,
        });
    },
    get_vcv_record: async (args) => {
        return tools.getVCVRecord(args.variation_id);
    },
    batch_variant_lookup: async (args) => {
        return tools.batchVariantLookup(args.variation_ids);
    },
    get_variant_frequency: async (args) => {
        return tools.getVariantFrequency(args.variation_id);
    },
    search_by_review_status: async (args) => {
        return tools.searchByReviewStatus(args.review_status, {
            gene: args.gene,
            clinicalSignificance: args.clinical_significance,
            maxResults: args.max_results,
        });
    },
    lookup_by_rsid: async (args) => {
        return tools.lookupByRsId(args.rs_id);
    },
};
export function createServer() {
    const server = new Server({
        name: 'clinvar-mcp-server',
        version: '1.0.0',
    }, {
        capabilities: {
            tools: {},
        },
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOLS };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const handler = toolHandlers[name];
        if (!handler) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ error: `Unknown tool: ${name}` }),
                    },
                ],
                isError: true,
            };
        }
        try {
            const result = await handler(args || {});
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
                        text: JSON.stringify({ error: errorMessage }),
                    },
                ],
                isError: true,
            };
        }
    });
    return server;
}
export async function runServer() {
    initializeClient();
    const server = createServer();
    const transport = new StdioServerTransport();
    process.on('SIGINT', async () => {
        console.error('Shutting down ClinVar MCP server...');
        closeClient();
        await server.close();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        console.error('Shutting down ClinVar MCP server...');
        closeClient();
        await server.close();
        process.exit(0);
    });
    await server.connect(transport);
    console.error('ClinVar MCP server running on stdio');
}
//# sourceMappingURL=server.js.map