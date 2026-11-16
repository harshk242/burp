import type { AxiosAdapter } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initClient, resultMeta } from '../client.js';
import {
  handleGetStudyDetails,
  handleGetTrialStatistics,
  handleSearchStudies,
} from '../tools/search-handlers.js';
import { handleSearchInternationalStudies } from '../tools/advanced-handlers.js';

function study(nctId: string, countries: string[] = []) {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: nctId },
      statusModule: { overallStatus: 'RECRUITING' },
      contactsLocationsModule: {
        locations: countries.map((country) => ({ facility: 'F', city: 'C', country })),
      },
    },
  };
}

const mockGet = vi.fn();
const adapter: AxiosAdapter = async (config) => {
  const { data } = await mockGet(config.url, { params: config.params });
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};

beforeEach(() => {
  mockGet.mockReset();
  initClient({}, { adapter });
});

describe('resultMeta', () => {
  it('reports null instead of a fabricated count when the API omits totalCount', () => {
    expect(resultMeta({ studies: [] }, 10)).toEqual({
      totalCount: null,
      resultsShown: 10,
      hasMore: false,
    });
  });

  it('keeps a real zero and flags more pages', () => {
    expect(resultMeta({ studies: [], totalCount: 0 }, 0).totalCount).toBe(0);
    expect(resultMeta({ studies: [], nextPageToken: 'abc' }, 10).hasMore).toBe(true);
  });
});

describe('trial names come from the registry record', () => {
  const engage = {
    hasResults: true,
    protocolSection: {
      identificationModule: {
        nctId: 'NCT02477800',
        briefTitle: "221AD301 Phase 3 Study of Aducanumab (BIIB037) in Early Alzheimer's Disease",
        acronym: 'ENGAGE',
        orgStudyIdInfo: { id: '221AD301' },
        secondaryIdInfos: [{ id: '2015-000966-72' }],
      },
      statusModule: { overallStatus: 'TERMINATED' },
    },
  };

  it('search summaries carry acronym, sponsor protocol ID and hasResults', async () => {
    mockGet.mockResolvedValueOnce({ data: { studies: [engage, study('NCT00000002')] } });
    const result = await handleSearchStudies({ query: 'aducanumab' }) as { studies: unknown[] };
    expect(result.studies[0]).toMatchObject({
      nctId: 'NCT02477800', acronym: 'ENGAGE', orgStudyId: '221AD301', hasResults: true,
    });
    expect(result.studies[1]).toMatchObject({ acronym: null, orgStudyId: null, hasResults: false });
  });

  it('study details carry acronym and secondary IDs', async () => {
    mockGet.mockResolvedValueOnce({ data: { studies: [engage] } });
    const result = await handleGetStudyDetails({ nctId: 'NCT02477800' });
    expect(result).toMatchObject({
      identification: {
        nctId: 'NCT02477800', acronym: 'ENGAGE', orgStudyId: '221AD301', secondaryIds: ['2015-000966-72'],
      },
      hasResults: true,
    });
  });
});

describe('fetchStudies count handling', () => {
  it('requests countTotal and returns the API total', async () => {
    mockGet.mockResolvedValueOnce({
      data: { totalCount: 3769, studies: [study('NCT00000001')], nextPageToken: 't' },
    });

    const result = await handleSearchStudies({ condition: 'melanoma' });

    expect(mockGet.mock.calls[0]![1].params).toMatchObject({
      countTotal: true,
      'query.cond': 'melanoma',
    });
    expect(result).toMatchObject({ totalCount: 3769, resultsShown: 1, hasMore: true });
  });

  it('reports the total for statistics and labels the sample', async () => {
    mockGet.mockResolvedValueOnce({ data: { totalCount: 500, studies: [study('NCT00000001')] } });

    const result = (await handleGetTrialStatistics({})) as Record<string, unknown>;

    expect(result.totalStudies).toBe(500);
    expect(result.analyzedStudies).toBe(1);
    expect(result.note).toMatch(/sample/);
  });

  it('separates the API total from locally filtered results', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        totalCount: 3769,
        studies: [study('NCT00000001', ['US', 'FR']), study('NCT00000002', ['US'])],
      },
    });

    const result = (await handleSearchInternationalStudies({
      condition: 'melanoma',
    })) as Record<string, unknown>;

    expect(result).not.toHaveProperty('totalCount');
    expect(result).toMatchObject({ apiTotalCount: 3769, resultsShown: 1 });
    expect(result.countNote).toMatch(/before local multi-country filtering/);
  });
});
