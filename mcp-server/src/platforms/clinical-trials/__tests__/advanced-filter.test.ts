import type { AxiosAdapter } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchStudies, initClient } from '../client.js';
import { handlers as toolHandlers } from '../tools/index.js';

const adapter = vi.fn<AxiosAdapter>(async (config) => ({
  data: { studies: [] }, status: 200, statusText: 'OK', headers: {}, config,
}));

beforeEach(() => {
  adapter.mockClear();
  initClient({}, { adapter });
});

const lastParams = () => adapter.mock.calls.at(-1)![0].params as Record<string, unknown>;

describe('ClinicalTrials field filters use filter.advanced', () => {
  it.each([
    ['search_by_intervention', { intervention: 'pembrolizumab', phase: 'PHASE3', interventionType: 'DRUG' },
      'AREA[InterventionType]DRUG AND AREA[Phase]PHASE3'],
    ['search_by_condition', { condition: 'melanoma', phase: 'PHASE2' }, 'AREA[Phase]PHASE2'],
    ['search_studies', { condition: 'x', phase: 'PHASE1', sex: 'FEMALE', age: 'ADULT' },
      'AREA[Phase]PHASE1 AND AREA[Sex](FEMALE OR ALL) AND AREA[StdAge]ADULT'],
    ['search_by_sponsor', { sponsor: 'Merck', sponsorType: 'INDUSTRY' }, 'AREA[LeadSponsorClass]INDUSTRY'],
    ['search_by_date_range', { startDateFrom: '2020-01-01', completionDateTo: '2024-12-31' },
      'AREA[StartDate]RANGE[2020-01-01,MAX] AND AREA[PrimaryCompletionDate]RANGE[MIN,2024-12-31]'],
    ['get_studies_with_results', { completedAfter: '2021-06-01' },
      'AREA[HasResults]true AND AREA[PrimaryCompletionDate]RANGE[2021-06-01,MAX]'],
    ['get_pediatric_studies', { ageRange: 'INFANT' },
      'AREA[StdAge]CHILD AND (AREA[MinimumAge]RANGE[MIN,2 years] OR AREA[MinimumAge]MISSING)'
      + ' AND (AREA[MaximumAge]RANGE[0 years,MAX] OR AREA[MaximumAge]MISSING)'],
    ['search_by_eligibility_criteria', { sex: 'ALL', healthyVolunteers: false, inclusionKeywords: 'prior (chemo)' },
      'AREA[HealthyVolunteers]false AND AREA[EligibilityCriteria](prior chemo)'],
  ])('%s', async (tool, args, expected) => {
    await toolHandlers[tool](args);
    expect(lastParams()['filter.advanced']).toBe(expected);
    expect(Object.keys(lastParams()).filter((k) => k.startsWith('filter.') && k !== 'filter.advanced'
      && k !== 'filter.overallStatus')).toEqual([]);
  });

  it('omits filter.advanced when no field filters are given', async () => {
    await toolHandlers.search_by_condition({ condition: 'melanoma' });
    expect(lastParams()).not.toHaveProperty('filter.advanced');
  });

  it('rejects params the v2 API does not accept before sending', async () => {
    await expect(fetchStudies({ 'filter.phase': 'PHASE3' })).rejects.toThrow('filter.phase');
    expect(adapter).not.toHaveBeenCalled();
  });
});
