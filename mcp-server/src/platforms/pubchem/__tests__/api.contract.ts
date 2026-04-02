/**
 * PubChem REST API (PUG REST) contract tests.
 * Validates structural stability of ~4 key endpoints.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, params?: Record<string, string | number>): Promise<unknown> {
  const res = await axios.get(url, {
    params,
    headers: { Accept: 'application/json' },
    timeout: 20_000,
  });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PubChem REST API Contracts', () => {
  // 1. Full compound record — most critical, used by get_compound_info handler
  it('GET /compound/cid/{cid}/JSON schema is stable (Aspirin, CID 2244)', async () => {
    const data = await fetchJson(`${BASE}/compound/cid/2244/JSON`);
    await assertSchemaStable('pubchem/compound-full.schema.json', data);
  });

  // 2. Compound properties — used by get_compound_properties handler
  it('GET /compound/cid/{cid}/property/*/JSON schema is stable', async () => {
    const props = [
      'MolecularFormula',
      'MolecularWeight',
      'CanonicalSMILES',
      'InChI',
      'InChIKey',
      'XLogP',
      'TPSA',
      'HBondDonorCount',
      'HBondAcceptorCount',
    ].join(',');
    const data = await fetchJson(`${BASE}/compound/cid/2244/property/${props}/JSON`);
    await assertSchemaStable('pubchem/compound-properties.schema.json', data);
  });

  // 3. Synonyms — used by get_compound_synonyms handler
  it('GET /compound/cid/{cid}/synonyms/JSON schema is stable', async () => {
    const data = await fetchJson(`${BASE}/compound/cid/2244/synonyms/JSON`);
    await assertSchemaStable('pubchem/compound-synonyms.schema.json', data);
  });

  // 4. Compound search by name — used by search_compounds handler
  it('GET /compound/name/{name}/JSON schema is stable (Aspirin)', async () => {
    const data = await fetchJson(`${BASE}/compound/name/aspirin/JSON`);
    await assertSchemaStable('pubchem/compound-by-name.schema.json', data);
  });

  // 5. Compound description — used by get_compound_info and related handlers
  it('GET /compound/cid/{cid}/description/JSON schema is stable (Aspirin)', async () => {
    const data = await fetchJson(`${BASE}/compound/cid/2244/description/JSON`);
    await assertSchemaStable('pubchem/compound-description.schema.json', data);
  });
});
