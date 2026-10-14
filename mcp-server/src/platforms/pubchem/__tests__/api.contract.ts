import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { PUBCHEM_POLICY, createPubChemClient } from '../client.js';
import {
  compoundDescriptions,
  compoundRecord,
  PUBCHEM_PUG_REST_BASE_URL,
} from '../endpoints.js';

const PUBCHEM_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createPubChemClient({ policy: { ...PUBCHEM_POLICY, ...CONTRACT_OVERRIDES } });

async function fetchJson(url: string, params?: Record<string, string | number>): Promise<unknown> {
  const res = await http.get(url, { params });
  return res.data;
}

function pubchemContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: PUBCHEM_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

describe('PubChem REST API Contracts', () => {
  pubchemContractTest('GET /compound/cid/{cid}/JSON schema is stable (Aspirin, CID 2244)', async () => {
    const data = await fetchJson(compoundRecord(2244));
    await assertSchemaStable('pubchem/compound-full.schema.json', data);
  });

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

  pubchemContractTest('GET /compound/cid/{cid}/synonyms/JSON schema is stable', async () => {
    const data = await fetchJson(`${PUBCHEM_PUG_REST_BASE_URL}/compound/cid/2244/synonyms/JSON`);
    await assertSchemaStable('pubchem/compound-synonyms.schema.json', data);
  });

  pubchemContractTest('GET /compound/name/{name}/JSON schema is stable (Aspirin)', async () => {
    const data = await fetchJson(`${PUBCHEM_PUG_REST_BASE_URL}/compound/name/aspirin/JSON`);
    await assertSchemaStable('pubchem/compound-by-name.schema.json', data);
  });

  pubchemContractTest('GET /compound/cid/{cid}/description/ schema is stable (Aspirin)', async () => {
    const data = await fetchJson(compoundDescriptions(2244));
    await assertSchemaStable('pubchem/compound-description.schema.json', data);
  });
});
