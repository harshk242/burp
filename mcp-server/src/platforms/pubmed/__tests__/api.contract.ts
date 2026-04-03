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
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const NCBI_API_KEY = process.env.NCBI_API_KEY;

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const res = await axios.get(`${BASE}/${endpoint}`, {
    params: fullParams,
    timeout: 20_000,
  });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PubMed NCBI E-utilities API Contracts', () => {
  // 1. esearch — used by searchPubmed, searchWithFilters, searchByAuthor, searchByJournal
  it('esearch.fcgi schema is stable (CRISPR search)', async () => {
    const data = await ncbiGet('esearch.fcgi', {
      term: 'CRISPR',
      retmax: 5,
    });
    await assertSchemaStable('pubmed/esearch-pubmed.schema.json', data);
  });

  // 2. esummary — used by getArticleSummary, batchGetSummaries
  it('esummary.fcgi schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('esummary.fcgi', {
      id: '28485846',
    });
    await assertSchemaStable('pubmed/esummary-pubmed.schema.json', data);
  });

  // 3. elink neighbor — used by findRelatedArticles
  it('elink.fcgi (neighbor) schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('elink.fcgi', {
      id: '28485846',
      cmd: 'neighbor',
    });
    await assertSchemaStable('pubmed/elink-related.schema.json', data);
  });

  // 4. elink citedin — used by getCitations
  it('elink.fcgi (citedin) schema is stable (PMID 28485846)', async () => {
    const data = await ncbiGet('elink.fcgi', {
      id: '28485846',
      linkname: 'pubmed_pubmed_citedin',
    });
    await assertSchemaStable('pubmed/elink-citedin.schema.json', data);
  });
});
