/**
 * PubChem REST API (PUG REST) contract tests.
 * Validates structural stability of ~4 key endpoints.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { PUBCHEM_POLICY, createPubChemClient } from '../client.js';
import {
  compoundDescriptions,
  compoundRecord,
  PUBCHEM_PUG_REST_BASE_URL,
} from '../endpoints.js';

const PUBCHEM_CONTRACT_TIMEOUT_MS = 150_000;

/** Contract tests ride out longer bad patches than production (same overrides as Ensembl). */
const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createPubChemClient({ policy: { ...PUBCHEM_POLICY, ...CONTRACT_OVERRIDES } });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Only the HTTP request is retried; schema assertions run once on the result.
async function fetchJson(url: string, params?: Record<string, string | number>): Promise<unknown> {
  const res = await http.get(url, { params });
  return res.data;
}

function pubchemContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: PUBCHEM_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PubChem REST API Contracts', () => {
  // 1. Full compound record — most critical, used by get_compound_info handler
  pubchemContractTest('GET /compound/cid/{cid}/JSON schema is stable (Aspirin, CID 2244)', async () => {
    const data = await fetchJson(compoundRecord(2244));
    await assertSchemaStable('pubchem/compound-full.schema.json', data);
  });

  // 2. Compound properties — used by get_compound_properties handler
  pubchemContractTest('GET /compound/cid/{cid}/property/*/JSON schema is stable', async () => {
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
    const data = await fetchJson(
      `${PUBCHEM_PUG_REST_BASE_URL}/compound/cid/2244/property/${props}/JSON`,
    );
    await assertSchemaStable('pubchem/compound-properties.schema.json', data);
  });

  // 3. Synonyms — used by get_compound_synonyms handler
  pubchemContractTest('GET /compound/cid/{cid}/synonyms/JSON schema is stable', async () => {
    const data = await fetchJson(`${PUBCHEM_PUG_REST_BASE_URL}/compound/cid/2244/synonyms/JSON`);
    await assertSchemaStable('pubchem/compound-synonyms.schema.json', data);
  });

  // 4. Compound search by name — used by search_compounds handler
  pubchemContractTest('GET /compound/name/{name}/JSON schema is stable (Aspirin)', async () => {
    const data = await fetchJson(`${PUBCHEM_PUG_REST_BASE_URL}/compound/name/aspirin/JSON`);
    await assertSchemaStable('pubchem/compound-by-name.schema.json', data);
  });

  // 5. Compound description — optionally used by get_compound_info
  pubchemContractTest('GET /compound/cid/{cid}/description/ schema is stable (Aspirin)', async () => {
    const data = await fetchJson(compoundDescriptions(2244));
    await assertSchemaStable('pubchem/compound-description.schema.json', data);
  });
});
