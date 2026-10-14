import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { UNIPROT_BASE_URL, UNIPROT_POLICY, createUniProtClient } from '../client.js';

const BASE = UNIPROT_BASE_URL;
const JSON_HEADERS = { Accept: 'application/json' };
const UNIPROT_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createUniProtClient({ policy: { ...UNIPROT_POLICY, ...CONTRACT_OVERRIDES } });

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await http.get(url, { params, headers: JSON_HEADERS });
  return res.data;
}

function uniprotContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: UNIPROT_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

describe('UniProt REST API Contracts', () => {
  uniprotContractTest('GET /uniprotkb/{accession} schema is stable (P04637, TP53)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P04637`);
    await assertSchemaStable('uniprot/protein-entry.schema.json', data);
  });

  uniprotContractTest('GET /uniprotkb/{accession} schema is stable (P69905, HBA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P69905`);
    await assertSchemaStable('uniprot/protein-entry-minimal.schema.json', data);
  });

  uniprotContractTest('GET /uniprotkb/search schema is stable (query=kinase)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'kinase',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-proteins.schema.json', data);
  });

  uniprotContractTest('GET /uniprotkb/search schema is stable (gene:BRCA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'gene:"BRCA1"',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-by-gene.schema.json', data);
  });

  // UniProt GO queries use bare numeric IDs without "GO:" prefix or quotes.
  // go:"GO:0006915" returns zero results (false-positive empty fixture).
  uniprotContractTest('GET /uniprotkb/search schema is stable (reviewed apoptosis GO)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'reviewed:true AND go:0006915',
      format: 'json',
      size: '3',
    });
    await assertSchemaStable('uniprot/search-by-function.schema.json', data);
  });
});
