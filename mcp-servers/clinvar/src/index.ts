#!/usr/bin/env node

// ClinVar MCP Server - Entry Point

import { parseArgs } from 'node:util';
import { runServer } from './server.js';

const { values } = parseArgs({
  options: {
    transport: {
      type: 'string',
      short: 't',
      default: 'stdio',
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

function printHelp(): void {
  console.log(`
ClinVar MCP Server

A Model Context Protocol server for searching and retrieving clinical variant
data from the NCBI ClinVar database.

Usage: clinvar-mcp-server [options]

Options:
  -t, --transport <type>  Transport type: stdio (default: stdio)
  -v, --verbose           Enable verbose logging
  --help                  Show this help message

Environment Variables:
  NCBI_API_KEY            NCBI API key for higher rate limits (10 req/s vs 3 req/s)
                          Obtain from: https://www.ncbi.nlm.nih.gov/account/settings/

Available Tools:
  Variant Lookup:
    - search_variants_by_gene    Search variants in a gene
    - get_variant_info           Get variant information
    - get_vcv_record             Get full VCV record
    - lookup_by_coordinates      Find variants by genomic position
    - lookup_by_rsid             Find variants by rsID
    - batch_variant_lookup       Lookup multiple variants

  Clinical Significance:
    - get_clinical_significance  Get significance details
    - search_by_condition        Search by disease/condition
    - search_by_molecular_consequence  Search by consequence type
    - get_variant_submissions    Get all submissions for a variant
    - get_variant_frequency      Get population frequency data
    - search_by_review_status    Search by review quality

Examples:
  # Run with stdio transport (for Claude Desktop/Code)
  clinvar-mcp-server

  # Run with verbose logging
  clinvar-mcp-server --verbose
`);
}

async function main(): Promise<void> {
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.verbose) {
    console.error('Starting ClinVar MCP server...');
    console.error(`Transport: ${values.transport}`);
    console.error(`NCBI API Key: ${process.env.NCBI_API_KEY ? 'configured (10 req/s)' : 'not configured (3 req/s)'}`);
  }

  try {
    if (values.transport === 'stdio') {
      await runServer();
    } else {
      console.error(`Transport "${values.transport}" is not yet implemented. Using stdio.`);
      await runServer();
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
