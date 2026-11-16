import { describe, expect, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { UNIPROT_BASE_URL, UNIPROT_POLICY, createUniProtClient } from '../client.js';

import { INFO_FIELDS, stripEvidences } from '../entry-fields.js';
import { SEARCH_FIELDS, summarizeSearch } from '../search-fields.js';

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
    const data = await fetchJson(`${BASE}/uniprotkb/P04637`, { format: 'json', fields: INFO_FIELDS });
    await assertSchemaStable('uniprot/protein-entry.schema.json', stripEvidences(data));
  });

  uniprotContractTest('GET /uniprotkb/{accession} schema is stable (P69905, HBA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P69905`, { format: 'json', fields: 'accession,sequence,mass' });
    await assertSchemaStable('uniprot/protein-entry-minimal.schema.json', data);
  });

  uniprotContractTest('GET /uniprotkb/search schema is stable (query=kinase)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'reviewed:true AND (kinase) AND organism_name:"Homo sapiens"',
      format: 'json',
      fields: SEARCH_FIELDS,
      size: '3',
    });
    const summary = summarizeSearch(data);
    expect(summary.results.length).toBeGreaterThan(0);
    expect(summary.results.every((entry: any) => entry.accession && entry.reviewed)).toBe(true);
    await assertSchemaStable('uniprot/search-proteins.schema.json', summary);
  });

  uniprotContractTest('GET /uniprotkb/search schema is stable (gene:BRCA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'reviewed:true AND gene:"BRCA1" AND organism_name:"Homo sapiens"',
      format: 'json',
      fields: SEARCH_FIELDS,
      size: '3',
    });
    const summary = summarizeSearch(data);
    expect(summary.results.length).toBeGreaterThan(0);
    expect(summary.results.every((entry: any) => entry.accession && entry.reviewed)).toBe(true);
    await assertSchemaStable('uniprot/search-by-gene.schema.json', summary);
  });

  // Match the handler: strip GO: and quote the numeric ID.
  uniprotContractTest('GET /uniprotkb/search schema is stable (reviewed apoptosis GO)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/search`, {
      query: 'reviewed:true AND go:"0006915"',
      format: 'json',
      fields: SEARCH_FIELDS,
      size: '3',
    });
    const summary = summarizeSearch(data);
    expect(summary.results.length).toBeGreaterThan(0);
    expect(summary.results.every((entry: any) => entry.accession && entry.reviewed)).toBe(true);
    await assertSchemaStable('uniprot/search-by-function.schema.json', summary);
  });
});
