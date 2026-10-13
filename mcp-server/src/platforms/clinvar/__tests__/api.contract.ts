/**
 * ClinVar (NCBI E-utilities) API contract tests.
 * Uses JSON output mode (retmode=json) for schema extraction.
 * The NCBI API key is optional but reduces rate limit risk in CI.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { createNcbiRateLimiter } from '../../../shared/rate-limiter.js';
import { CLINVAR_NCBI_POLICY, createClinVarNcbiHttp } from '../client.js';

const NCBI_API_KEY = process.env.NCBI_API_KEY;
const CLINVAR_CONTRACT_TIMEOUT_MS = 150_000;

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
const http = createClinVarNcbiHttp({
  policy: {
    ...CLINVAR_NCBI_POLICY,
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
    db: 'clinvar',
    retmode: 'json',
    ...params,
    ...(NCBI_API_KEY ? { api_key: NCBI_API_KEY } : {}),
  };
  const res = await http.get(endpoint, { params: fullParams });
  return res.data;
}

function clinvarContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: CLINVAR_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClinVar NCBI E-utilities API Contracts', () => {
  // 1. esearch by rsID — used by lookup_by_rsid handler
  clinvarContractTest('esearch.fcgi schema is stable (rs1042522, TP53 variant)', async () => {
    const data = await ncbiGet('esearch.fcgi', {
      term: 'rs1042522',
      retmax: 5,
    });
    await assertSchemaStable('clinvar/esearch-rsid.schema.json', data);
  });

  // 2. esearch by gene — used by search_variants_by_gene handler
  clinvarContractTest('esearch.fcgi schema is stable (TP53 gene search)', async () => {
    const data = await ncbiGet('esearch.fcgi', {
      term: 'TP53[gene]',
      retmax: 5,
    });
    await assertSchemaStable('clinvar/esearch-gene.schema.json', data);
  });

  // 3. esearch by condition — used by search_by_condition handler
  clinvarContractTest('esearch.fcgi schema is stable (Lynch syndrome condition)', async () => {
    const data = await ncbiGet('esearch.fcgi', {
      term: 'Lynch syndrome[dis]',
      retmax: 5,
    });
    await assertSchemaStable('clinvar/esearch-condition.schema.json', data);
  });

  // 4. esummary by known stable IDs — used by get_variant_info / get_variant_submissions
  clinvarContractTest('esummary.fcgi schema is stable (ClinVar IDs 7105, 7106)', async () => {
    const data = await ncbiGet('esummary.fcgi', {
      id: '7105,7106',
    });
    await assertSchemaStable('clinvar/esummary-variants.schema.json', data);
  });
});
