/**
 * UniProt REST API contract tests.
 * Tests 2 endpoints with 5 query shapes that BURP handlers depend on.
 * Note: FASTA endpoints return plain text — not schema-testable, skipped here.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://rest.uniprot.org';
const JSON_HEADERS = { Accept: 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await axios.get(url, { params, headers: JSON_HEADERS, timeout: 20_000 });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UniProt REST API Contracts', () => {
  // 1. Protein entry (feature-rich) — used by handleGetProteinInfo, handleGetProteinFeatures,
  //    handleGetProteinStructure, handleGetProteinVariants handlers
  it('GET /uniprotkb/{accession} schema is stable (P04637, TP53)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P04637`);
    await assertSchemaStable('uniprot/protein-entry.schema.json', data);
  });

  // 2. Protein entry (smaller protein) — validates schema stability across protein sizes
  it('GET /uniprotkb/{accession} schema is stable (P69905, HBA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P69905`);
    await assertSchemaStable('uniprot/protein-entry-minimal.schema.json', data);
  });

  // 3. Search by keyword — used by handleSearchProteins handler
  it('GET /uniprotkb/search schema is stable (query=kinase)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'kinase',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-proteins.schema.json', data);
  });

  // 4. Search by gene name — used by handleSearchByGene handler
  it('GET /uniprotkb/search schema is stable (gene:BRCA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'gene:"BRCA1"',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-by-gene.schema.json', data);
  });

  // 5. Search by GO function — used by handleSearchByFunction handler
  it('GET /uniprotkb/search schema is stable (reviewed apoptosis GO)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'reviewed:true AND go:"GO:0006915"',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-by-function.schema.json', data);
  });
});
