/**
 * Reactome Content Service API contract tests.
 * Tests key endpoints that BURP handlers depend on.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://reactome.org/ContentService';
const JSON_HEADERS = { Accept: 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await axios.get(url, { params, headers: JSON_HEADERS, timeout: 20_000 });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Reactome Content Service API Contracts', () => {
  // 1. Search pathways — used by handleSearchPathways
  it('GET /search/query schema is stable (TP53 pathways)', async () => {
    const data = await fetchJson(`${BASE}/search/query`, {
      query: 'TP53',
      types: 'Pathway',
      cluster: 'true',
    });
    await assertSchemaStable('reactome/search-query.schema.json', data);
  });

  // 2. Pathway details — used by handleGetPathwayDetails
  it('GET /data/query/{id} schema is stable (Glycolysis R-HSA-68886)', async () => {
    const data = await fetchJson(`${BASE}/data/query/R-HSA-68886`);
    await assertSchemaStable('reactome/data-query-pathway.schema.json', data);
  });

  // 3. Pathway events/hierarchy — used by handleGetPathwayHierarchy
  it('GET /data/pathway/{id}/containedEvents schema is stable (R-HSA-68886)', async () => {
    const data = await fetchJson(`${BASE}/data/pathway/R-HSA-68886/containedEvents`);
    await assertSchemaStable('reactome/data-events.schema.json', data);
  });

  // 4. Pathway participants — used by handleGetPathwayParticipants
  it('GET /data/participants/{id} schema is stable (R-HSA-68886)', async () => {
    const data = await fetchJson(`${BASE}/data/participants/R-HSA-68886`);
    await assertSchemaStable('reactome/data-participants.schema.json', data);
  });

  // 5. Pathways by entity — used by handleFindPathwaysByGene
  it('GET /data/pathways/low/entity/{id} schema is stable (PTEN R-HSA-199420)', async () => {
    const data = await fetchJson(`${BASE}/data/pathways/low/entity/R-HSA-199420`);
    await assertSchemaStable('reactome/pathways-by-entity.schema.json', data);
  });
});
