/**
 * ClinicalTrials.gov v2 API contract tests.
 * All queries hit the single /studies endpoint with different param combos.
 *
 * Run:  bun run --filter bio-mcp-unified test:contracts
 * Init: UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts
 */

import { describe, expect, it } from 'vitest';
import axios from 'axios';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';

const BASE = 'https://clinicaltrials.gov/api/v2';

// The registry has many sparse, registry-managed modules. Request exactly the
// fields each handler reads so the contract covers our dependency surface
// rather than the incidental shape of whichever studies appear on page one.
const SUMMARY_FIELDS = [
  'NCTId',
  'BriefTitle',
  'OverallStatus',
  'StartDate',
  'StudyType',
  'Phase',
  'LeadSponsorName',
  'Condition',
].join(',');

const CONDITION_FIELDS = [
  SUMMARY_FIELDS,
  'Sex',
  'MinimumAge',
  'MaximumAge',
  'HealthyVolunteers',
].join(',');

const RECRUITING_FIELDS = [
  CONDITION_FIELDS,
  'LocationFacility',
  'LocationCity',
  'LocationState',
  'LocationCountry',
].join(',');

const DETAIL_FIELDS = [
  RECRUITING_FIELDS,
  'OfficialTitle',
  'PrimaryCompletionDate',
  'LeadSponsorClass',
  'EligibilityCriteria',
].join(',');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(
  url: string,
  fields: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const res = await axios.get(url, {
    params: { fields, ...params },
    timeout: 20_000,
  });
  return res.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClinicalTrials.gov v2 API Contracts', () => {
  // 1. General search — used by handleSearchStudies
  it('GET /studies schema is stable (query.term=aspirin)', async () => {
    const data = await fetchJson(`${BASE}/studies`, SUMMARY_FIELDS, {
      'format': 'json',
      'query.term': 'aspirin',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-search.schema.json', data);
  });

  // 2. By condition — used by handleSearchByCondition
  it('GET /studies schema is stable (query.cond=breast cancer)', async () => {
    const data = await fetchJson(`${BASE}/studies`, CONDITION_FIELDS, {
      'format': 'json',
      'query.cond': 'breast cancer',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-by-condition.schema.json', data);
  });

  // 3. By intervention — used by handleSearchByIntervention
  it('GET /studies schema is stable (query.intr=aspirin)', async () => {
    const data = await fetchJson(`${BASE}/studies`, SUMMARY_FIELDS, {
      'format': 'json',
      'query.intr': 'aspirin',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-by-intervention.schema.json', data);
  });

  // 4. By NCT ID — used by handleGetStudyDetails
  it('GET /studies schema is stable (filter.ids=NCT01141153)', async () => {
    const data = await fetchJson(`${BASE}/studies`, DETAIL_FIELDS, {
      'format': 'json',
      'query.term': 'NCT01141153',
      'filter.ids': 'NCT01141153',
      'pageSize': '1',
    });
    await assertSchemaStable('clinical-trials/study-by-nctid.schema.json', data);
  });

  // 5. Recruiting + condition — used by handleGetRecruitingStudies
  it('GET /studies schema is stable (recruiting diabetes)', async () => {
    const data = await fetchJson(`${BASE}/studies`, RECRUITING_FIELDS, {
      'format': 'json',
      'filter.overallStatus': 'RECRUITING',
      'query.cond': 'diabetes',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-recruiting.schema.json', data);
  });

  // 6. countTotal — every handler reports totalCount via fetchStudies
  it('GET /studies returns totalCount only with countTotal=true', async () => {
    const params = { 'format': 'json', 'query.cond': 'melanoma', 'pageSize': '2' };
    const without = (await fetchJson(`${BASE}/studies`, 'NCTId', params)) as {
      totalCount?: number;
    };
    const counted = (await fetchJson(`${BASE}/studies`, 'NCTId', {
      ...params,
      countTotal: 'true',
    })) as { totalCount?: number; studies: unknown[] };
    const empty = (await fetchJson(`${BASE}/studies`, 'NCTId', {
      'format': 'json',
      'query.cond': 'zzqqxxnotarealcondition',
      countTotal: 'true',
    })) as { totalCount?: number };

    expect(without.totalCount).toBeUndefined();
    expect(counted.totalCount).toBeGreaterThan(counted.studies.length);
    expect(empty.totalCount).toBe(0);
  });
});
