/**
 * Offline guard for request params. Every tool runs with every declared
 * argument and every enum value (generated from the input schemas), and each
 * outgoing request must only use params `GET /studies` accepts. The live API
 * rejects anything else with HTTP 400 (e.g. `filter.phase`), which hand-picked
 * mocked tests never noticed because a mock accepts any param.
 */
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initClient, STUDIES_PARAMS } from '../client.js';
import { handlers, tools } from '../tools/index.js';
import { argVariants } from './tool-args.js';

/** A study with every module the handlers read, so no code path short-circuits. */
const STUDY = {
  protocolSection: {
    identificationModule: { nctId: 'NCT01141153', briefTitle: 'Fixture study' },
    statusModule: {
      overallStatus: 'COMPLETED',
      startDateStruct: { date: '2020-01-01', type: 'ACTUAL' },
      primaryCompletionDateStruct: { date: '2022-01-01', type: 'ACTUAL' },
    },
    sponsorCollaboratorsModule: { leadSponsor: { name: 'Merck', class: 'INDUSTRY' } },
    armsInterventionsModule: { interventions: [{ name: 'pembrolizumab', type: 'DRUG' }] },
    conditionsModule: { conditions: ['cancer'] },
    designModule: { phases: ['PHASE2'], studyType: 'INTERVENTIONAL' },
    contactsLocationsModule: {
      locations: [
        { facility: 'F', city: 'Boston', country: 'United States' },
        { facility: 'G', city: 'Paris', country: 'France' },
      ],
    },
    eligibilityModule: {
      eligibilityCriteria: 'prior chemotherapy', healthyVolunteers: true, sex: 'ALL',
      minimumAge: '18 Years', maximumAge: '65 Years',
    },
  },
};

const adapter = vi.fn<AxiosAdapter>(async (config) => ({
  data: { studies: [STUDY], totalCount: 1 }, status: 200, statusText: 'OK', headers: {}, config,
}));

beforeEach(() => {
  adapter.mockClear();
  initClient({}, { adapter });
});

const requests = (): InternalAxiosRequestConfig[] => adapter.mock.calls.map(([config]) => config);

describe('ClinicalTrials tool registry', () => {
  it('has exactly one handler per declared tool', () => {
    expect(Object.keys(handlers).sort()).toEqual(tools.map((t) => t.name).sort());
  });
});

describe.each(tools.map((tool) => [tool.name, tool] as const))('%s request params', (_name, tool) => {
  it.each(argVariants(tool).map((v) => [v.label, v.args] as const))('%s', async (_label, args) => {
    await handlers[tool.name](args);

    expect(requests().length).toBeGreaterThan(0);
    for (const config of requests()) {
      expect(config.url).toBe('/studies');
      const params = (config.params ?? {}) as Record<string, unknown>;
      expect(Object.keys(params).filter((key) => !STUDIES_PARAMS.has(key))).toEqual([]);
      for (const [key, value] of Object.entries(params)) {
        expect(value, key).not.toBeUndefined();
        expect(String(value), key).not.toMatch(/\bundefined\b|\bnull\b|\[object Object\]/);
      }
      const advanced = params['filter.advanced'];
      if (advanced !== undefined) expect(String(advanced)).toMatch(/^AREA\[|^\(/);
    }
  });
});
