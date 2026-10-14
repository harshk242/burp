import type { AxiosAdapter } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { initializeClient } from '../client.js';
import { getVariantFrequency } from '../tools/clinical-significance.js';
import { decodeFrequencySummary } from '../frequency-decoder.js';
import summary from './fixtures/frequency-summary.json' with { type: 'json' };

function setup() {
  const adapter = vi.fn<AxiosAdapter>(async (config) => ({ data: JSON.stringify(summary), status: 200, statusText: 'OK', headers: {}, config }));
  initializeClient({ adapter });
  return adapter;
}

describe('ClinVar frequency summaries', () => {
  it('returns real ESummary allele frequencies with their source and allele', async () => {
    const adapter = setup();
    const expected = { variationId: '7105', hasFrequencyData: true, frequencies: [{ source: '1000 Genomes Project', alleleFrequency: 0.00399, minorAllele: 'T', measureId: '22144' }] };
    expect(await getVariantFrequency('7105')).toEqual(expected);
    expect(await getVariantFrequency('VCV000007105')).toEqual(expected);
    expect(adapter.mock.calls[0][0]).toMatchObject({ url: 'esummary.fcgi', params: { id: '7105', retmode: 'json' } });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('reports absent frequency data only for a valid empty frequency set', async () => {
    setup();
    expect(await getVariantFrequency('7106')).toEqual({ variationId: '7106', hasFrequencyData: false, frequencies: [] });
  });

  it('retains a real zero frequency', () => {
    expect(decodeFrequencySummary({ result: { '1': { variation_set: [{ allele_freq_set: [{ source: 'Example', value: '0' }] }] } } }, '1').frequencies[0].alleleFrequency).toBe(0);
  });

  it.each(['', 'invalid', '-0.1', '1.1', null])('rejects malformed frequency values (%j)', (value) => {
    expect(() => decodeFrequencySummary({ result: { '1': { variation_set: [{ allele_freq_set: [{ source: 'Example', value }] }] } } }, '1')).toThrow('Invalid ClinVar allele frequency');
  });

  it.each([{ error: 'API failed' }, { result: { '1': { error: 'Invalid uid' } } }, { result: {} }])('surfaces upstream/missing-record errors (%j)', (response) => {
    expect(() => decodeFrequencySummary(response, '1')).toThrow();
  });
});
