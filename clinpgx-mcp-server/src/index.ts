#!/usr/bin/env node

// ClinPGx MCP Server - Entry Point

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
ClinPGx MCP Server (PharmGKB)

A Model Context Protocol server for searching and retrieving pharmacogenomic
data from the PharmGKB database.

Usage: clinpgx-mcp-server [options]

Options:
  -t, --transport <type>  Transport type: stdio (default: stdio)
  -v, --verbose           Enable verbose logging
  --help                  Show this help message

Available Tools:
  Genes:
    - search_genes               Search pharmacogenes
    - get_gene_info              Get gene details
    - get_gene_pathways          Get gene pathways

  Drugs:
    - search_drugs               Search drugs
    - get_drug_info              Get drug details
    - get_drug_labels            Get FDA/EMA drug labels

  Variants:
    - search_variants            Search pharmacogenomic variants
    - get_variant_info           Get variant details
    - get_variant_annotations    Get variant clinical annotations
    - get_star_alleles           Get star allele definitions

  Clinical Annotations:
    - get_clinical_annotations   Get drug-gene associations
    - get_drug_gene_interactions Get all interactions for a gene
    - get_annotations_by_evidence Filter by evidence level

  Dosing Guidelines:
    - get_dosing_guidelines      Get CPIC/DPWG guidelines
    - get_guidelines_for_pair    Get guidelines for drug-gene pair
    - get_actionable_pairs       Get actionable drug-gene pairs

  Other:
    - get_pathways               Get PK/PD pathways
    - get_database_stats         Get database statistics

Examples:
  # Run with stdio transport (for Claude Desktop/Code)
  clinpgx-mcp-server

  # Run with verbose logging
  clinpgx-mcp-server --verbose
`);
}

async function main(): Promise<void> {
  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.verbose) {
    console.error('Starting ClinPGx MCP server (PharmGKB)...');
    console.error(`Transport: ${values.transport}`);
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
