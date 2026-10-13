/**
 * ClinPGx (PharmGKB) API contract tests.
 * Tests 6 key endpoints that BURP handlers depend on.
 * Canonical inputs use stable, well-known pharmacogenomic entities.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { CLINPGX_POLICY, PHARMGKB_BASE_URL, createClinPGxHttp } from '../client.js';

const BASE = PHARMGKB_BASE_URL;
const CLINPGX_CONTRACT_TIMEOUT_MS = 150_000;

/** Contract tests ride out longer bad patches than production (same overrides as Ensembl). */
const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createClinPGxHttp({ policy: { ...CLINPGX_POLICY, ...CONTRACT_OVERRIDES } });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Only the HTTP request is retried; schema assertions run once on the result.
async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await http.get(url, { params });
  return res.data;
}

function clinpgxContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: CLINPGX_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClinPGx (PharmGKB) API Contracts', () => {
  // 1. Gene search — used by searchGenes, getGeneInfo handlers
  clinpgxContractTest('GET /data/gene schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/gene`, { symbol: 'CYP2D6' });
    await assertSchemaStable('clinpgx/gene-search.schema.json', data);
  });

  // 2. Chemical/drug search — used by searchDrugs, getDrugInfo handlers
  clinpgxContractTest('GET /data/chemical schema is stable (warfarin)', async () => {
    const data = await fetchJson(`${BASE}/data/chemical`, { name: 'warfarin' });
    await assertSchemaStable('clinpgx/chemical-search.schema.json', data);
  });

  // 3. Variant search — used by searchVariants, getVariantInfo handlers
  clinpgxContractTest('GET /data/variant schema is stable (rs1065852)', async () => {
    const data = await fetchJson(`${BASE}/data/variant`, { symbol: 'rs1065852' });
    await assertSchemaStable('clinpgx/variant-search.schema.json', data);
  });

  // 4. Clinical annotations — used by getClinicalAnnotationsForGene handler
  clinpgxContractTest('GET /data/clinicalAnnotation schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/clinicalAnnotation`, {
      'location.genes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/clinical-annotation.schema.json', data);
  });

  // 5. Guideline annotations — used by getDosingGuidelinesForGene handler
  clinpgxContractTest('GET /data/guidelineAnnotation schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/guidelineAnnotation`, {
      'relatedGenes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/guideline-annotation.schema.json', data);
  });

  // 6. Pathways — used by getGenePathways handler
  clinpgxContractTest('GET /data/pathway schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/pathway`, {
      'genes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/pathway-search.schema.json', data);
  });
});
