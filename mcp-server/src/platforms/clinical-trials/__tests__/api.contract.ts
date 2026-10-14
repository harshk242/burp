import { describe, expect, it } from 'vitest';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import {
  CLINICAL_TRIALS_BASE_URL,
  CLINICAL_TRIALS_POLICY,
  createClinicalTrialsClient,
} from '../client.js';

const BASE = CLINICAL_TRIALS_BASE_URL;
const CLINICAL_TRIALS_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createClinicalTrialsClient({
  policy: { ...CLINICAL_TRIALS_POLICY, ...CONTRACT_OVERRIDES },
});

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

async function fetchJson(
  url: string,
  fields: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const res = await http.get(url, { params: { fields, ...params } });
  return res.data;
}

function clinicalTrialsContractTest(name: string, test: () => Promise<void>, requests = 1): void {
  const timeout = CLINICAL_TRIALS_CONTRACT_TIMEOUT_MS + (requests - 1) * CONTRACT_OVERRIDES.totalBudgetMs;
  it(name, { timeout, retry: 0 }, test);
}

describe('ClinicalTrials.gov v2 API Contracts', () => {
  clinicalTrialsContractTest('GET /studies schema is stable (query.term=aspirin)', async () => {
    const data = await fetchJson(`${BASE}/studies`, SUMMARY_FIELDS, {
      'format': 'json',
      'query.term': 'aspirin',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-search.schema.json', data);
  });

  clinicalTrialsContractTest('GET /studies schema is stable (query.cond=breast cancer)', async () => {
    const data = await fetchJson(`${BASE}/studies`, CONDITION_FIELDS, {
      'format': 'json',
      'query.cond': 'breast cancer',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-by-condition.schema.json', data);
  });

  clinicalTrialsContractTest('GET /studies schema is stable (query.intr=aspirin)', async () => {
    const data = await fetchJson(`${BASE}/studies`, SUMMARY_FIELDS, {
      'format': 'json',
      'query.intr': 'aspirin',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-by-intervention.schema.json', data);
  });

  clinicalTrialsContractTest('GET /studies schema is stable (filter.ids=NCT01141153)', async () => {
    const data = await fetchJson(`${BASE}/studies`, DETAIL_FIELDS, {
      'format': 'json',
      'query.term': 'NCT01141153',
      'filter.ids': 'NCT01141153',
      'pageSize': '1',
    });
    await assertSchemaStable('clinical-trials/study-by-nctid.schema.json', data);
  });

  clinicalTrialsContractTest('GET /studies schema is stable (recruiting diabetes)', async () => {
    const data = await fetchJson(`${BASE}/studies`, RECRUITING_FIELDS, {
      'format': 'json',
      'filter.overallStatus': 'RECRUITING',
      'query.cond': 'diabetes',
      'pageSize': '3',
    });
    await assertSchemaStable('clinical-trials/studies-recruiting.schema.json', data);
  });

  clinicalTrialsContractTest('GET /studies returns totalCount only with countTotal=true', async () => {
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
  }, 3);
});
