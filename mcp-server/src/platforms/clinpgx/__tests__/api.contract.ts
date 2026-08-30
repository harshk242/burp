/**
 * ClinPGx (PharmGKB) API contract tests.
 * Tests 6 key endpoints that BURP handlers depend on.
 * Canonical inputs use stable, well-known pharmacogenomic entities.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://api.clinpgx.org/v1';
const JSON_HEADERS = { Accept: 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await axios.get(url, { params, headers: JSON_HEADERS, timeout: 20_000 });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClinPGx (PharmGKB) API Contracts', () => {
  // 1. Gene search — used by searchGenes, getGeneInfo handlers
  it('GET /data/gene schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/gene`, { symbol: 'CYP2D6' });
    await assertSchemaStable('clinpgx/gene-search.schema.json', data);
  });

  // 2. Chemical/drug search — used by searchDrugs, getDrugInfo handlers
  it('GET /data/chemical schema is stable (warfarin)', async () => {
    const data = await fetchJson(`${BASE}/data/chemical`, { name: 'warfarin' });
    await assertSchemaStable('clinpgx/chemical-search.schema.json', data);
  });

  // 3. Variant search — used by searchVariants, getVariantInfo handlers
  it('GET /data/variant schema is stable (rs1065852)', async () => {
    const data = await fetchJson(`${BASE}/data/variant`, { symbol: 'rs1065852' });
    await assertSchemaStable('clinpgx/variant-search.schema.json', data);
  });

  // 4. Clinical annotations — used by getClinicalAnnotationsForGene handler
  it('GET /data/clinicalAnnotation schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/clinicalAnnotation`, {
      'location.genes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/clinical-annotation.schema.json', data);
  });

  // 5. Guideline annotations — used by getDosingGuidelinesForGene handler
  it('GET /data/guidelineAnnotation schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/guidelineAnnotation`, {
      'relatedGenes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/guideline-annotation.schema.json', data);
  });

  // 6. Pathways — used by getGenePathways handler
  it('GET /data/pathway schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/pathway`, {
      'genes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/pathway-search.schema.json', data);
  });
});
