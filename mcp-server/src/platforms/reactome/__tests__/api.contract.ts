/**
 * Reactome Content Service API contract tests.
 * Tests key endpoints that BURP handlers depend on.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { REACTOME_BASE_URL, REACTOME_POLICY, createReactomeClient } from '../client.js';

const BASE = REACTOME_BASE_URL;
const JSON_HEADERS = { Accept: 'application/json' };
const REACTOME_CONTRACT_TIMEOUT_MS = 150_000;

/** Contract tests ride out longer bad patches than production (same overrides as Ensembl). */
const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createReactomeClient({ policy: { ...REACTOME_POLICY, ...CONTRACT_OVERRIDES } });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Only the HTTP request is retried; schema assertions run once on the result.
async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await http.get(url, { params, headers: JSON_HEADERS });
  return res.data;
}

function reactomeContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: REACTOME_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Reactome Content Service API Contracts', () => {
  // 1. Search pathways — used by handleSearchPathways
  reactomeContractTest('GET /search/query schema is stable (TP53 pathways)', async () => {
    const data = await fetchJson(`${BASE}/search/query`, {
      query: 'TP53',
      types: 'Pathway',
      cluster: 'true',
    });
    await assertSchemaStable('reactome/search-query.schema.json', data);
  });

  // 2. Pathway details — used by handleGetPathwayDetails
  reactomeContractTest('GET /data/query/{id} schema is stable (Glycolysis R-HSA-68886)', async () => {
    const data = await fetchJson(`${BASE}/data/query/R-HSA-68886`);
    await assertSchemaStable('reactome/data-query-pathway.schema.json', data);
  });

  // 3. Pathway events/hierarchy — used by handleGetPathwayHierarchy
  reactomeContractTest('GET /data/pathway/{id}/containedEvents schema is stable (R-HSA-68886)', async () => {
    const data = await fetchJson(`${BASE}/data/pathway/R-HSA-68886/containedEvents`);
    await assertSchemaStable('reactome/data-events.schema.json', data);
  });

  // 4. Pathway participants — used by handleGetPathwayParticipants
  reactomeContractTest('GET /data/participants/{id} schema is stable (R-HSA-68886)', async () => {
    const data = await fetchJson(`${BASE}/data/participants/R-HSA-68886`);
    await assertSchemaStable('reactome/data-participants.schema.json', data);
  });

  // 5. Pathways by entity — used by handleFindPathwaysByGene
  reactomeContractTest('GET /data/pathways/low/entity/{id} schema is stable (PTEN R-HSA-199420)', async () => {
    const data = await fetchJson(`${BASE}/data/pathways/low/entity/R-HSA-199420`);
    await assertSchemaStable('reactome/pathways-by-entity.schema.json', data);
  });
});
