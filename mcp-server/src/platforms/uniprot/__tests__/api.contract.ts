import { describe, expect, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { UNIPROT_BASE_URL, UNIPROT_POLICY, createUniProtClient, initClient, resetClient } from '../client.js';

import { ENTRY_FIELDS, INFO_FIELDS, stripEvidences } from '../entry-fields.js';
import { SEARCH_FIELDS, summarizeSearch } from '../search-fields.js';
import { proteinHandlers } from '../tools/protein-handlers.js';
import { searchHandlers } from '../tools/search-handlers.js';

const BASE = UNIPROT_BASE_URL;
const JSON_HEADERS = { Accept: 'application/json' };
const UNIPROT_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const CONTRACT_POLICY = { ...UNIPROT_POLICY, ...CONTRACT_OVERRIDES };
const http = createUniProtClient({ policy: CONTRACT_POLICY });

// Run a handler against live UniProt with the contract retry policy.
async function liveHandler(handler: (args: Record<string, unknown>) => Promise<unknown>, args: Record<string, unknown>): Promise<any> {
  initClient({}, { policy: CONTRACT_POLICY });
  try {
    return await handler(args);
  } finally {
    resetClient();
  }
}

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await http.get(url, { params, headers: JSON_HEADERS });
  return res.data;
}

function uniprotContractTest(name: string, test: () => Promise<void>): void {
  // oxlint-disable-next-line vitest/expect-expect -- assertions live in the callback; call sites are checked as test blocks
  it(name, { timeout: UNIPROT_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

describe('UniProt REST API Contracts', () => {
  uniprotContractTest('GET /uniprotkb/{accession} schema is stable (P04637, TP53)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P04637`, { format: 'json', fields: INFO_FIELDS });
    await assertSchemaStable('uniprot/protein-entry.schema.json', stripEvidences(data));
  });

  uniprotContractTest('GET /uniprotkb/{accession} schema is stable (P69905, HBA1)', async () => {
    const data = await fetchJson(`${BASE}/uniprotkb/P69905`, { format: 'json', fields: ENTRY_FIELDS.sequence });
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

  uniprotContractTest('search reports X-Total-Results and summaries are bounded', async () => {
    const result = await liveHandler(searchHandlers.search_by_function, { goTerm: 'GO:0004672', organism: '9606', size: 3 });
    expect(result.totalResults).toBeGreaterThan(100);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((entry: any) => entry.taxonId === 9606 && entry.reviewed)).toBe(true);
  });

  uniprotContractTest('batch lookup handles case, isoforms, merged and malformed accessions', async () => {
    const result = await liveHandler(proteinHandlers.batch_protein_lookup, {
      accessions: ['p04637', 'P04637-2', 'Q16535', 'XYZ!!', 'P00001'],
    });
    expect(result.batchResults).toMatchObject([
      { accession: 'p04637', success: true, data: { accession: 'P04637', entryId: 'P53_HUMAN' } },
      { accession: 'P04637-2', success: true, data: { accession: 'P04637-2' } },
      { accession: 'Q16535', success: true, mergedInto: 'P04637' },
      { accession: 'XYZ!!', success: false },
      { accession: 'P00001', success: false, inactiveReason: 'DEMERGED' },
    ]);
  });

  uniprotContractTest('variant descriptions still state clinical significance (BRCA1)', async () => {
    const result = await liveHandler(proteinHandlers.get_protein_variants, { accession: 'P38398' });
    expect(result.significanceCounts.benign).toBeGreaterThan(0);
    expect(result.significanceCounts['uncertain significance']).toBeGreaterThan(0);
    expect(result.excludedDiseaseMentionCount).toBeGreaterThan(0);
    expect(result.diseaseVariantCount).toBeGreaterThan(0);
    expect(result.diseaseVariants.every((v: any) => !['benign', 'likely benign', 'uncertain significance'].includes(v.clinicalSignificance))).toBe(true);
  });
});
