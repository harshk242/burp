import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { CLINPGX_POLICY, PHARMGKB_BASE_URL, createClinPGxHttp } from '../client.js';

const BASE = PHARMGKB_BASE_URL;
const CLINPGX_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createClinPGxHttp({ policy: { ...CLINPGX_POLICY, ...CONTRACT_OVERRIDES } });

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await http.get(url, { params });
  return res.data;
}

function clinpgxContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: CLINPGX_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

describe('ClinPGx (PharmGKB) API Contracts', () => {
  clinpgxContractTest('GET /data/gene schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/gene`, { symbol: 'CYP2D6' });
    await assertSchemaStable('clinpgx/gene-search.schema.json', data);
  });

  clinpgxContractTest('GET /data/chemical schema is stable (warfarin)', async () => {
    const data = await fetchJson(`${BASE}/data/chemical`, { name: 'warfarin' });
    await assertSchemaStable('clinpgx/chemical-search.schema.json', data);
  });

  clinpgxContractTest('GET /data/variant schema is stable (rs1065852)', async () => {
    const data = await fetchJson(`${BASE}/data/variant`, { symbol: 'rs1065852' });
    await assertSchemaStable('clinpgx/variant-search.schema.json', data);
  });

  clinpgxContractTest('GET /data/clinicalAnnotation schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/clinicalAnnotation`, {
      'location.genes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/clinical-annotation.schema.json', data);
  });

  clinpgxContractTest('GET /data/guidelineAnnotation schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/guidelineAnnotation`, {
      'relatedGenes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/guideline-annotation.schema.json', data);
  });

  clinpgxContractTest('GET /data/pathway schema is stable (CYP2D6)', async () => {
    const data = await fetchJson(`${BASE}/data/pathway`, {
      'genes.symbol': 'CYP2D6',
    });
    await assertSchemaStable('clinpgx/pathway-search.schema.json', data);
  });
});
