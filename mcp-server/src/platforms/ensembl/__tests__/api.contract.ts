/**
 * Ensembl REST API contract tests.
 * Tests ~4 key endpoints that BURP handlers depend on.
 * Canonical inputs use stable, well-known biological entities.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://rest.ensembl.org';
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await axios.get(url, { params, headers: JSON_HEADERS, timeout: 20_000 });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Ensembl REST API Contracts', () => {
  // 1. Gene lookup — most critical, used by lookup_gene handler
  it('GET /lookup/id/{id} schema is stable (BRCA2)', async () => {
    const data = await fetchJson(`${BASE}/lookup/id/ENSG00000139618`);
    await assertSchemaStable('ensembl/lookup-gene.schema.json', data);
  });

  // 2. Cross-references — used by get_xrefs handler
  it('GET /xrefs/id/{id} schema is stable (BRCA2)', async () => {
    const data = await fetchJson(`${BASE}/xrefs/id/ENSG00000139618`);
    await assertSchemaStable('ensembl/xrefs-gene.schema.json', data);
  });

  // 3. Sequence fetch — used by get_sequence handler
  it('GET /sequence/id/{id} schema is stable (BRCA2 transcript)', async () => {
    // Use a known transcript for a shorter response
    const data = await fetchJson(`${BASE}/sequence/id/ENST00000380152`, {
      type: 'cds',
    });
    await assertSchemaStable('ensembl/sequence-cds.schema.json', data);
  });

  // 4. Variant info — used by get_variant_consequences / get_variants handlers
  it('GET /variation/{species}/{id} schema is stable (rs6025, Factor V Leiden)', async () => {
    const data = await fetchJson(`${BASE}/variation/homo_sapiens/rs6025`);
    await assertSchemaStable('ensembl/variation-rsid.schema.json', data);
  });

  // 5. Assembly info — used by get_assembly_info handler
  it('GET /info/assembly/{species} schema is stable', async () => {
    const data = await fetchJson(`${BASE}/info/assembly/homo_sapiens`);
    await assertSchemaStable('ensembl/info-assembly.schema.json', data);
  });

  // 6. Homologs — used by get_homologs handler
  // Note: /homology/symbol/{species}/{symbol} is more reliable than /homology/id/{id}
  it('GET /homology/symbol/{species}/{symbol} schema is stable (TP53, mouse)', async () => {
    const data = await fetchJson(`${BASE}/homology/symbol/human/TP53`, {
      type: 'orthologues',
      target_species: 'mus_musculus',
    });
    await assertSchemaStable('ensembl/homology-gene.schema.json', data);
  });
});
