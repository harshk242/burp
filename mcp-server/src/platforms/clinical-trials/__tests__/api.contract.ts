/**
 * ClinicalTrials.gov v2 API contract tests.
 * All queries hit the single /studies endpoint with different param combos.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://clinicaltrials.gov/api/v2';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const res = await axios.get(url, { params, timeout: 20_000 });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClinicalTrials.gov v2 API Contracts', () => {
  // 1. General search — used by handleSearchStudies
  it('GET /studies schema is stable (query.term=aspirin)', async () => {
    const data = await fetchJson(`${BASE}/studies`, {
      'query.term': 'aspirin',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-search.schema.json', data);
  });

  // 2. By condition — used by handleSearchByCondition
  it('GET /studies schema is stable (query.cond=breast cancer)', async () => {
    const data = await fetchJson(`${BASE}/studies`, {
      'query.cond': 'breast cancer',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-by-condition.schema.json', data);
  });

  // 3. By intervention — used by handleSearchByIntervention
  it('GET /studies schema is stable (query.intr=aspirin)', async () => {
    const data = await fetchJson(`${BASE}/studies`, {
      'query.intr': 'aspirin',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-by-intervention.schema.json', data);
  });

  // 4. By NCT ID — used by handleGetStudyDetails
  it('GET /studies schema is stable (filter.ids=NCT00000419)', async () => {
    const data = await fetchJson(`${BASE}/studies`, {
      'filter.ids': 'NCT00000419',
      'pageSize': '1',
    });
    await assertSchemaStable('clinical-trials/study-by-nctid.schema.json', data);
  });

  // 5. Recruiting + condition — used by handleGetRecruitingStudies
  it('GET /studies schema is stable (recruiting diabetes)', async () => {
    const data = await fetchJson(`${BASE}/studies`, {
      'filter.overallStatus': 'RECRUITING',
      'query.cond': 'diabetes',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-recruiting.schema.json', data);
  });
});
