#!/usr/bin/env node

// PubMed MCP Server - Entry Point

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
PubMed MCP Server

A Model Context Protocol server for searching and retrieving literature
from the NCBI PubMed database.

Usage: pubmed-mcp-server [options]

Options:
  -t, --transport <type>  Transport type: stdio (default: stdio)
  -v, --verbose           Enable verbose logging
  --help                  Show this help message

Environment Variables:
  NCBI_API_KEY            NCBI API key for higher rate limits (10 req/s vs 3 req/s)
                          Obtain from: https://www.ncbi.nlm.nih.gov/account/settings/

Available Tools:
  Search:
    - search_pubmed              Basic PubMed search
    - search_with_filters        Advanced search with filters
    - search_by_author           Search by author name
    - search_by_journal          Search by journal
    - search_clinical_trials_literature  Search clinical trial literature

  Fetch:
    - fetch_article_details      Get full article details
    - get_article_abstract       Get article abstract
    - get_article_summary        Get article summary
    - batch_fetch_articles       Fetch multiple articles

  Links:
    - find_related_articles      Find related articles
    - get_citations              Get citing articles
    - get_references             Get article references

  Analysis:
    - get_mesh_terms             Get MeSH terms
    - get_publication_trends     Publication trends over time
    - format_citation            Format article citation

Examples:
  # Run with stdio transport (for Claude Desktop/Code)
  pubmed-mcp-server

  # Run with verbose logging
  pubmed-mcp-server --verbose
`);
}

async function main(): Promise<void> {
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.verbose) {
    console.error('Starting PubMed MCP server...');
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
