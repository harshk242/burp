import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { CHEMBL_BASE_URL, CHEMBL_POLICY, createChemblClient } from '../client.js';

const BASE = CHEMBL_BASE_URL;
const CHEMBL_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createChemblClient({ policy: { ...CHEMBL_POLICY, ...CONTRACT_OVERRIDES } });

async function fetchJson(url: string, params?: Record<string, string | number>): Promise<unknown> {
  const res = await http.get(url, { params });
  return res.data;
}

function chemblContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: CHEMBL_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

describe('ChEMBL REST API Contracts', () => {
  chemblContractTest('GET /molecule/{id} schema is stable (Aspirin, CHEMBL25)', async () => {
    const data = await fetchJson(`${BASE}/molecule/CHEMBL25.json`);
    await assertSchemaStable('chembl/molecule.schema.json', data);
  });

  chemblContractTest('GET /target/{id} schema is stable (EGFR, CHEMBL203)', async () => {
    const data = await fetchJson(`${BASE}/target/CHEMBL203.json`);
    await assertSchemaStable('chembl/target.schema.json', data);
  });

  chemblContractTest('GET /activity schema is stable (filter by molecule)', async () => {
    const data = await fetchJson(`${BASE}/activity.json`, {
      molecule_chembl_id: 'CHEMBL25',
      limit: 3,
    });
    await assertSchemaStable('chembl/activity-list.schema.json', data);
  });

  chemblContractTest('GET /mechanism schema is stable (filter by molecule)', async () => {
    const data = await fetchJson(`${BASE}/mechanism.json`, {
      molecule_chembl_id: 'CHEMBL25',
    });
    await assertSchemaStable('chembl/mechanism-list.schema.json', data);
  });

  chemblContractTest('GET /assay/{id} schema is stable (CHEMBL655942)', async () => {
    const data = await fetchJson(`${BASE}/assay/CHEMBL655942.json`);
    await assertSchemaStable('chembl/assay.schema.json', data);
  });
});
