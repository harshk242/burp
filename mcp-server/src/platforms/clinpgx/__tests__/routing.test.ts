import type { AxiosAdapter } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { PharmGKBClient } from '../client.js';
import { isPharmGKBAccession } from '../utils.js';

describe('ClinPGx accession routing', () => {
  it.each(['PAH', 'PAX6', 'PARP1'])('routes %s as a gene symbol', async (symbol) => {
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({ data: { data: [{ id: 'PA128', symbol }] }, status: 200, statusText: 'OK', headers: {}, config }));
    expect((await new PharmGKBClient({ adapter }).getGeneInfo(symbol))?.symbol).toBe(symbol);
    expect(adapter.mock.calls[0][0]).toMatchObject({ url: '/data/gene', params: { symbol } });
  });

  it.each([
    ['getGeneInfo', '/data/gene'],
    ['getDrugInfo', '/data/chemical'],
    ['getVariantInfo', '/data/variant'],
  ] as const)('routes PA128 to the accession endpoint for %s', async (method, endpoint) => {
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({ data: { data: { id: 'PA128', symbol: 'CYP2D6', name: 'test record' } }, status: 200, statusText: 'OK', headers: {}, config }));
    await new PharmGKBClient({ adapter })[method]('PA128');
    expect(adapter.mock.calls[0][0].url).toBe(`${endpoint}/PA128`);
  });

  it.each([
    ['getDrugInfo', '/data/chemical', 'name'],
    ['getVariantInfo', '/data/variant', 'symbol'],
  ] as const)('uses the search endpoint for non-accessions in %s', async (method, endpoint, param) => {
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({ data: { data: [] }, status: 200, statusText: 'OK', headers: {}, config }));
    await new PharmGKBClient({ adapter })[method]('PA-name');
    expect(adapter.mock.calls[0][0]).toMatchObject({ url: endpoint, params: { [param]: 'PA-name' } });
  });

  it('requires the whole accession to be PA followed by digits', () => {
    expect(isPharmGKBAccession('PA128')).toBe(true);
    for (const symbol of ['PA', 'PAH', 'PA128x', 'xPA128']) expect(isPharmGKBAccession(symbol)).toBe(false);
  });
});
