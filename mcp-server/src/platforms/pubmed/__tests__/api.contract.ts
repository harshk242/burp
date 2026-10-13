/**
 * PubMed (NCBI E-utilities) API contract tests.
 * Uses JSON output mode (retmode=json) for schema extraction.
 * The NCBI API key is optional but reduces rate limit risk in CI.
 *
 * Note: efetch.fcgi does NOT support retmode=json for PubMed — omitted here.
 * XML parsing is covered by unit tests.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { createNcbiRateLimiter } from '../../../shared/rate-limiter.js';
import { PUBMED_POLICY, createPubMedHttp } from '../client.js';

const NCBI_API_KEY = process.env.NCBI_API_KEY;
const PUBMED_CONTRACT_TIMEOUT_MS = 150_000;

/** Contract tests ride out longer bad patches than production (same overrides as Ensembl). */
const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
  // A shared CI IP can trip NCBI's limit: back off instead of failing the run.
  on429: 'retry' as const,
};

const rateLimiter = createNcbiRateLimiter(!!NCBI_API_KEY);
const http = createPubMedHttp({
  policy: {
    ...PUBMED_POLICY,
    ...CONTRACT_OVERRIDES,
    beforeAttempt: (signal) => rateLimiter.waitForToken(signal),
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Only the HTTP request is retried; schema assertions run once on the result.
async function ncbiGet(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  // NCBI rate limit: 3 req/s without API key. Space requests to ~2 req/s to stay safe.
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
  it(name, { timeout: PUBMED_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PubMed NCBI E-utilities API Contracts', () => {
  // 1. esearch — used by searchPubmed, searchWithFilters, searchByAuthor, searchByJournal
  pubmedContractTest('esearch.fcgi schema is stable (CRISPR search)', async () => {
    const data = await ncbiGet('esearch.fcgi', {
      term: 'CRISPR',
      retmax: 5,
    });
    await assertSchemaStable('pubmed/esearch-pubmed.schema.json', data);
  });

  // 2. esummary — used by getArticleSummary, batchGetSummaries
  pubmedContractTest('esummary.fcgi schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('esummary.fcgi', {
      id: '28485846',
    });
    await assertSchemaStable('pubmed/esummary-pubmed.schema.json', data);
  });

  // 3. elink neighbor — used by findRelatedArticles
  pubmedContractTest('elink.fcgi (neighbor) schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('elink.fcgi', {
      id: '28485846',
      cmd: 'neighbor',
    });
    await assertSchemaStable('pubmed/elink-related.schema.json', data);
  });

  // 4. elink citedin — used by getCitations
  pubmedContractTest('elink.fcgi (citedin) schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('elink.fcgi', {
      id: '28485846',
      linkname: 'pubmed_pubmed_citedin',
    });
    await assertSchemaStable('pubmed/elink-citedin.schema.json', data);
  });
});
