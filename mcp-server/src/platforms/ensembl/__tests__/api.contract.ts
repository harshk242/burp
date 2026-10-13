/**
 * Ensembl REST API contract tests.
 * Tests ~4 key endpoints that BURP handlers depend on.
 * Canonical inputs use stable, well-known biological entities.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { ENSEMBL_BASE_URL, ENSEMBL_POLICY, createEnsemblClient } from '../client.js';

const BASE = ENSEMBL_BASE_URL;
const ENSEMBL_CONTRACT_TIMEOUT_MS = 150_000;

/** Contract tests ride out longer bad patches than production (plan: "Ensembl policy"). */
const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
};

const client = createEnsemblClient({ policy: { ...ENSEMBL_POLICY, ...CONTRACT_OVERRIDES } });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Only the HTTP request is retried; schema assertions run once on the result.
async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await client.get(url, { params });
  return res.data;
}

function ensemblContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: ENSEMBL_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Ensembl REST API Contracts', () => {
  // 1. Gene lookup — most critical, used by lookup_gene handler
  ensemblContractTest('GET /lookup/id/{id} schema is stable (BRCA2)', async () => {
    const data = await fetchJson(`${BASE}/lookup/id/ENSG00000139618`);
    await assertSchemaStable('ensembl/lookup-gene.schema.json', data);
  });

  // 2. Cross-references — used by get_xrefs handler
  ensemblContractTest('GET /xrefs/id/{id} schema is stable (BRCA2)', async () => {
    const data = await fetchJson(`${BASE}/xrefs/id/ENSG00000139618`);
    await assertSchemaStable('ensembl/xrefs-gene.schema.json', data);
  });

  // 3. Sequence fetch — used by get_sequence handler
  ensemblContractTest('GET /sequence/id/{id} schema is stable (BRCA2 transcript)', async () => {
    // Use a known transcript for a shorter response
    const data = await fetchJson(`${BASE}/sequence/id/ENST00000380152`, {
      type: 'cds',
    });
    await assertSchemaStable('ensembl/sequence-cds.schema.json', data);
  });

  // 4. Variant info — used by get_variant_consequences / get_variants handlers
  ensemblContractTest('GET /variation/{species}/{id} schema is stable (rs6025, Factor V Leiden)', async () => {
    const data = await fetchJson(`${BASE}/variation/homo_sapiens/rs6025`);
    await assertSchemaStable('ensembl/variation-rsid.schema.json', data);
  });

  // 5. Assembly info — used by get_assembly_info handler
  ensemblContractTest('GET /info/assembly/{species} schema is stable', async () => {
    const data = await fetchJson(`${BASE}/info/assembly/homo_sapiens`);
    await assertSchemaStable('ensembl/info-assembly.schema.json', data);
  });

  // 6. Homologs — used by get_homologs handler
  // Exercise the same stable-ID endpoint and path shape used in production.
  ensemblContractTest('GET /homology/id/{species}/{id} schema is stable (TP53, mouse)', async () => {
    const data = await fetchJson(`${BASE}/homology/id/homo_sapiens/ENSG00000141510`, {
      type: 'orthologues',
      target_species: 'mus_musculus',
    });
    await assertSchemaStable('ensembl/homology-gene.schema.json', data);
  });
});
