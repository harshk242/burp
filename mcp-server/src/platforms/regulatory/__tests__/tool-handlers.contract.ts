import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pace } from '../../__test-utils__/tool-requests.js';
import { initClient, resetClient } from '../client.js';
import { handlers } from '../handlers.js';

type Result = Record<string, any>;
const TIMEOUT_MS = 120_000;

// openFDA allows 240 requests per minute without a key; the EMA file is downloaded once.
async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  await pace(300);
  return await handlers[name]!(args) as Result;
}

function regulatoryContractTest(name: string, test: () => Promise<void>): void {
  // oxlint-disable-next-line vitest/expect-expect -- assertions live in the callback; call sites are checked as test blocks
  it(name, { timeout: TIMEOUT_MS, retry: 0 }, test);
}

beforeAll(() => initClient(process.env));
afterAll(resetClient);

describe('openFDA live handlers', () => {
  regulatoryContractTest('drug search returns the Drugs@FDA original approval (Blenrep BLA761440)', async () => {
    const result = await call('search_fda_approvals', { drug: 'Blenrep' });
    const app = result.applications.find((a: Result) => a.application_number === 'BLA761440');
    expect(app?.original_approval?.date).toBe('2025-10-23');
    expect(result.data_last_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  regulatoryContractTest('indication search finds approvals the label endpoint knows about (SMA)', async () => {
    const result = await call('search_fda_approvals', { indication: 'spinal muscular atrophy' });
    const numbers = result.applications.map((a: Result) => a.application_number);
    expect(numbers).toEqual(expect.arrayContaining(['NDA209531', 'BLA761463', 'BLA125694']));
    const cber = result.applications.find((a: Result) => a.application_number === 'BLA125694');
    expect(cber).toMatchObject({ in_drugs_at_fda: false, original_approval: null });
  });

  regulatoryContractTest('date window lists original approvals inside the window only', async () => {
    const result = await call('search_fda_approvals', { approved_from: '2026-09-01', approved_to: '2026-09-30' });
    expect(result.applications.length).toBeGreaterThan(0);
    for (const app of result.applications) {
      expect(app.original_approval.date >= '2026-09-01' && app.original_approval.date <= '2026-09-30').toBe(true);
    }
  });

  regulatoryContractTest('label returns boxed-warning text (Xeljanz)', async () => {
    const result = await call('get_fda_label', { drug: 'Xeljanz', sections: ['boxed_warning'] });
    expect(result.found).toBe(true);
    expect(result.sections.boxed_warning.text).toMatch(/MORTALITY/);
  });

  regulatoryContractTest('unknown names come back empty rather than as errors', async () => {
    const result = await call('search_fda_approvals', { drug: 'zzqx-not-a-drug' });
    expect(result.total_applications).toBe(0);
  });
});

describe('EMA live handler', () => {
  regulatoryContractTest('medicines file keeps the fields the handler reads (Hepcludex)', async () => {
    const result = await call('search_ema_medicines', { query: 'Hepcludex' });
    expect(result.medicines[0]).toMatchObject({
      name: 'Hepcludex', status: 'Authorised', marketing_authorisation_date: '2020-07-31',
      url: expect.stringContaining('ema.europa.eu'),
    });
    expect(result.data_timestamp).toBeTruthy();
  });
});
