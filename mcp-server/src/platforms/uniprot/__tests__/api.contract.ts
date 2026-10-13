/**
 * UniProt REST API contract tests.
 * Tests 2 endpoints with 5 query shapes that BURP handlers depend on.
 * Note: FASTA endpoints return plain text — not schema-testable, skipped here.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { UNIPROT_BASE_URL, UNIPROT_POLICY, createUniProtClient } from '../client.js';

const BASE = UNIPROT_BASE_URL;
const JSON_HEADERS = { Accept: 'application/json' };
const UNIPROT_CONTRACT_TIMEOUT_MS = 150_000;

/** Contract tests ride out longer bad patches than production (same overrides as Ensembl). */
const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createUniProtClient({ policy: { ...UNIPROT_POLICY, ...CONTRACT_OVERRIDES } });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Only the HTTP request is retried; schema assertions run once on the result.
async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await http.get(url, { params, headers: JSON_HEADERS });
  return res.data;
}

function uniprotContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: UNIPROT_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UniProt REST API Contracts', () => {
  // 1. Protein entry (feature-rich) — used by handleGetProteinInfo, handleGetProteinFeatures,
  //    handleGetProteinStructure, handleGetProteinVariants handlers
  uniprotContractTest('GET /uniprotkb/{accession} schema is stable (P04637, TP53)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P04637`);
    await assertSchemaStable('uniprot/protein-entry.schema.json', data);
  });

  // 2. Protein entry (smaller protein) — validates schema stability across protein sizes
  uniprotContractTest('GET /uniprotkb/{accession} schema is stable (P69905, HBA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P69905`);
    await assertSchemaStable('uniprot/protein-entry-minimal.schema.json', data);
  });

  // 3. Search by keyword — used by handleSearchProteins handler
  uniprotContractTest('GET /uniprotkb/search schema is stable (query=kinase)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'kinase',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-proteins.schema.json', data);
  });

  // 4. Search by gene name — used by handleSearchByGene handler
  uniprotContractTest('GET /uniprotkb/search schema is stable (gene:BRCA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'gene:"BRCA1"',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-by-gene.schema.json', data);
  });

  // 5. Search by GO function — used by handleSearchByFunction handler
  // UniProt GO queries use bare numeric IDs without "GO:" prefix or quotes.
  // go:"GO:0006915" returns zero results (false-positive empty fixture).
  // go:0006915 (apoptotic process) returns hundreds of reviewed entries.
  uniprotContractTest('GET /uniprotkb/search schema is stable (reviewed apoptosis GO)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'reviewed:true AND go:0006915',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-by-function.schema.json', data);
  });
});
