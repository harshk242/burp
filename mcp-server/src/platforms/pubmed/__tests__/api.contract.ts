import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { PUBMED_POLICY, createPubMedHttp } from '../client.js';

const NCBI_API_KEY = process.env.NCBI_API_KEY;
const PUBMED_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
  on429: 'retry' as const,
};

// The factory takes tokens from the shared NCBI limiter for this key.
const http = createPubMedHttp({
  apiKey: NCBI_API_KEY,
  policy: { ...PUBMED_POLICY, ...CONTRACT_OVERRIDES },
});

async function ncbiGet(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  const delayMs = NCBI_API_KEY ? 100 : 500;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

  const fullParams: Record<string, string | number> = {
    db: 'pubmed',
    retmode: 'json',
    ...params,
    ...(NCBI_API_KEY ? { api_key: NCBI_API_KEY } : {}),
  };
  const res = await http.get(endpoint, { params: fullParams });
  return res.data;
}

function pubmedContractTest(name: string, test: () => Promise<void>): void {
  // oxlint-disable-next-line vitest/expect-expect -- assertions live in the callback; call sites are checked as test blocks
  it(name, { timeout: PUBMED_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

describe('PubMed NCBI E-utilities API Contracts', () => {
  pubmedContractTest('esearch.fcgi schema is stable (CRISPR search)', async () => {
    const data = await ncbiGet('esearch.fcgi', {
      term: 'CRISPR',
      retmax: 5,
    });
    await assertSchemaStable('pubmed/esearch-pubmed.schema.json', data);
  });

  pubmedContractTest('esummary.fcgi schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('esummary.fcgi', {
      id: '28485846',
    });
    await assertSchemaStable('pubmed/esummary-pubmed.schema.json', data);
  });

  pubmedContractTest('elink.fcgi (neighbor) schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('elink.fcgi', {
      id: '28485846',
      cmd: 'neighbor',
    });
    await assertSchemaStable('pubmed/elink-related.schema.json', data);
  });

  pubmedContractTest('elink.fcgi (citedin) schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('elink.fcgi', {
      id: '28485846',
      linkname: 'pubmed_pubmed_citedin',
    });
    await assertSchemaStable('pubmed/elink-citedin.schema.json', data);
  });
});
