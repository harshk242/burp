#!/usr/bin/env node
// Open Targets MCP Server - Entry Point
import { parseArgs } from 'node:util';
import { runServer } from './server.js';
const { values } = parseArgs({
    options: {
        transport: {
            type: 'string',
            short: 't',
            default: 'stdio',
        },
        host: {
            type: 'string',
            short: 'h',
            default: '0.0.0.0',
        },
        port: {
            type: 'string',
            short: 'p',
            default: '8000',
        },
        verbose: {
            type: 'boolean',
            short: 'v',
            default: false,
        },
        help: {
            type: 'boolean',
            default: false,
        },
    },
    allowPositionals: true,
});
function printHelp() {
    console.log(`
Open Targets MCP Server

Usage: open-targets-mcp [options]

Options:
  -t, --transport <type>  Transport type: stdio (default: stdio)
  -h, --host <host>       Host to bind to (default: 0.0.0.0)
  -p, --port <port>       Port to listen on (default: 8000)
  -v, --verbose           Enable verbose logging
  --help                  Show this help message

Environment Variables:
  OPEN_TARGETS_API_URL    Custom GraphQL API endpoint
                          (default: https://api.platform.opentargets.org/api/v4/graphql)

Examples:
  # Run with stdio transport (for Claude Desktop)
  open-targets-mcp

  # Run with verbose logging
  open-targets-mcp --verbose
`);
}
async function main() {
    if (values.help) {
        printHelp();
        process.exit(0);
    }
    if (values.verbose) {
        console.error('Starting Open Targets MCP server...');
        console.error(`Transport: ${values.transport}`);
        console.error(`API URL: ${process.env.OPEN_TARGETS_API_URL || 'https://api.platform.opentargets.org/api/v4/graphql'}`);
    }
    try {
        if (values.transport === 'stdio') {
            await runServer();
        }
        else {
            console.error(`Transport "${values.transport}" is not yet implemented. Using stdio.`);
            await runServer();
        }
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map