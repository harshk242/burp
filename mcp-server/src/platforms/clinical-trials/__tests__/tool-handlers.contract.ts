/**
 * Live contract for the tool handlers themselves (not hand-written URLs):
 * every tool runs against ClinicalTrials.gov with every declared argument and
 * every enum value. The API answers HTTP 400 for unknown params, unknown
 * `AREA[...]` fields and invalid enum values, so any drift between our tool
 * schemas/handlers and the API fails here.
 */
import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CLINICAL_TRIALS_BASE_URL,
  CLINICAL_TRIALS_POLICY,
  initClient,
  resetClient,
  STUDIES_PARAMS,
} from '../client.js';
import { handlers, tools } from '../tools/index.js';
import { argVariants } from './tool-args.js';

const OAS_URL = CLINICAL_TRIALS_BASE_URL.replace(/\/v2$/, '/oas/v2');
/** Keeps the ~100 sequential requests under the API's ~50 req/min limit. */
const PACING_MS = 1_300;
const TIMEOUT_MS = 150_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Query param names the OpenAPI spec declares for `GET /studies`. */
function studiesParamsFromSpec(yaml: string): Set<string> {
  const start = yaml.indexOf('\n  /studies:\n');
  const end = yaml.indexOf('\n  /', start + 1);
  const section = yaml.slice(start, end);
  return new Set([...section.matchAll(/- name: "?([\w.]+)"?/g)].map((m) => m[1]));
}

beforeAll(() => {
  initClient({}, {
    policy: {
      ...CLINICAL_TRIALS_POLICY,
      maxAttempts: 4,
      backoffMs: [2_000, 5_000, 10_000],
      totalBudgetMs: 120_000,
      jitter: 0,
    },
  });
});

afterAll(() => resetClient());

describe('ClinicalTrials.gov /studies param allowlist', () => {
  it('only allows params the OpenAPI spec declares', { timeout: TIMEOUT_MS }, async () => {
    const { data } = await axios.get<string>(OAS_URL, { responseType: 'text', timeout: 30_000 });
    const spec = studiesParamsFromSpec(data);
    expect(spec.size).toBeGreaterThan(10);
    expect([...STUDIES_PARAMS].filter((p) => !spec.has(p))).toEqual([]);
  });
});

describe.each(tools.map((tool) => [tool.name, tool] as const))('%s (live)', (_name, tool) => {
  it.each(argVariants(tool).map((v) => [v.label, v.args] as const))(
    '%s is accepted by the API',
    { timeout: TIMEOUT_MS, retry: 0 },
    async (_label, args) => {
      await sleep(PACING_MS);
      await expect(handlers[tool.name](args)).resolves.toBeDefined();
    },
  );
});
