import { afterEach, describe, expect, it } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import { initClient, resetClient } from '../client.js';
import { proteinHandlers as handlers } from '../tools/protein-handlers.js';
import { ACCESSION_PATTERN, normalizeAccession } from '../batch.js';
import { SEARCH_FIELDS } from '../search-fields.js';

const summaryEntry = (accession: string, name = `Protein ${accession}`) => ({
  primaryAccession: accession, uniProtkbId: `${accession}_HUMAN`, entryType: 'UniProtKB reviewed (Swiss-Prot)',
  proteinDescription: { recommendedName: { fullName: { value: name } } }, references: ['unneeded'],
});
// Mirrors live UniProt: /accessions omits inactive accessions; /search returns stubs.
const ACTIVE = ['P04637', 'P04637-2', 'P38398'];
const INACTIVE: Record<string, unknown> = {
  Q16535: { inactiveReasonType: 'MERGED', mergeDemergeTo: ['P04637'] },
  P00001: { inactiveReasonType: 'DEMERGED', mergeDemergeTo: ['P99998', 'P99999'] },
  Q99999: { inactiveReasonType: 'DELETED' },
};

function mock(text?: string) {
  const calls: InternalAxiosRequestConfig[] = [];
  initClient({}, { adapter: async config => {
    calls.push(config);
    let data: unknown = text;
    if (text === undefined && config.url === '/uniprotkb/accessions') {
      data = { results: String(config.params.accessions).split(',').filter(a => ACTIVE.includes(a)).map(a => summaryEntry(a)) };
    } else if (text === undefined && config.url === '/uniprotkb/search') {
      const requested = [...String(config.params.query).matchAll(/accession:(\S+)/g)].map(m => m[1]);
      data = { results: requested.filter(a => INACTIVE[a]).map(a => ({
        entryType: 'Inactive', primaryAccession: a, inactiveReason: INACTIVE[a],
      })) };
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  } });
  return calls;
}
afterEach(resetClient);

describe('accession validation', () => {
  it.each(['P04637', 'Q16535', 'A0A024R1R8', 'P04637-2', 'O15530', 'A2BC19'])('accepts %s', accession => {
    expect(ACCESSION_PATTERN.test(accession)).toBe(true);
  });
  it.each(['XYZ!!', 'P0463', 'P04637-', '12345', 'TP53', 'P04637 OR P1'])('rejects %s', accession => {
    expect(ACCESSION_PATTERN.test(normalizeAccession(accession))).toBe(false);
  });
  it('normalizes case and whitespace', () => {
    expect(normalizeAccession(' p04637-2 ')).toBe('P04637-2');
  });
});

describe('batch_protein_lookup', () => {
  it('reports each accession individually and only sends valid, normalized accessions', async () => {
    const calls = mock();
    const result: any = await handlers.batch_protein_lookup({
      accessions: ['p38398', 'XYZ!!', 'P04637-2', 'A0A0A0A0A0', 'P38398'],
    });
    expect(calls[0].url).toBe('/uniprotkb/accessions');
    expect(calls[0].params).toEqual({ accessions: 'P38398,P04637-2,A0A0A0A0A0', format: 'json', fields: SEARCH_FIELDS });
    expect(calls[1].params.query).toBe('accession:A0A0A0A0A0');
    expect(calls).toHaveLength(2);
    expect(result.batchResults).toEqual([
      { accession: 'p38398', success: true, data: expect.objectContaining({ accession: 'P38398', entryId: 'P38398_HUMAN' }) },
      { accession: 'XYZ!!', success: false, error: 'Invalid UniProt accession format' },
      { accession: 'P04637-2', success: true, data: expect.objectContaining({ accession: 'P04637-2' }) },
      { accession: 'A0A0A0A0A0', success: false, error: 'Accession not found in UniProtKB' },
      { accession: 'P38398', success: true, data: expect.objectContaining({ accession: 'P38398' }) },
    ]);
    expect(JSON.stringify(result)).not.toContain('unneeded');
  });
  it('resolves merged accessions and explains demerged or deleted ones', async () => {
    const calls = mock();
    const result: any = await handlers.batch_protein_lookup({ accessions: ['Q16535', 'P00001', 'q99999'] });
    expect(calls.map(c => c.url)).toEqual(['/uniprotkb/accessions', '/uniprotkb/search', '/uniprotkb/accessions']);
    expect(calls[2].params.accessions).toBe('P04637');
    expect(result.batchResults[0]).toMatchObject({ accession: 'Q16535', success: true, mergedInto: 'P04637', data: { accession: 'P04637' } });
    expect(result.batchResults[1]).toMatchObject({ success: false, inactiveReason: 'DEMERGED', replacedBy: ['P99998', 'P99999'] });
    expect(result.batchResults[1].error).toContain('P99998, P99999');
    expect(result.batchResults[2]).toMatchObject({ accession: 'q99999', success: false, inactiveReason: 'DELETED' });
  });
  it('does not refetch a merge target that was already requested', async () => {
    const calls = mock();
    const result: any = await handlers.batch_protein_lookup({ accessions: ['P04637', 'Q16535'] });
    expect(calls).toHaveLength(2);
    expect(result.batchResults[1]).toMatchObject({ success: true, mergedInto: 'P04637' });
  });
  it('makes no request when every accession is malformed', async () => {
    const calls = mock();
    const result: any = await handlers.batch_protein_lookup({ accessions: ['bad', '???'] });
    expect(calls).toHaveLength(0);
    expect(result.batchResults.every((r: any) => r.success === false)).toBe(true);
  });
  it.each(['tsv', 'fasta'])('returns raw %s from the accessions endpoint', async format => {
    const calls = mock('raw output');
    expect(await handlers.batch_protein_lookup({ accessions: ['p04637', 'P04637-2'], format })).toBe('raw output');
    expect(calls[0].url).toBe('/uniprotkb/accessions');
    expect(calls[0].params.accessions).toBe('P04637,P04637-2');
    expect(calls[0].params.fields).toBe(format === 'fasta' ? undefined : SEARCH_FIELDS.replace(',cc_function', ''));
  });
  it('names malformed accessions for text formats instead of sending them', async () => {
    const calls = mock('raw output');
    await expect(handlers.batch_protein_lookup({ accessions: ['P04637', 'XYZ!!'], format: 'tsv' }))
      .rejects.toThrow('XYZ!!');
    expect(calls).toHaveLength(0);
  });
  it.each([[], Array(26).fill('P04637'), [''], ['  '], [123]])('rejects invalid input %j', async accessions => {
    mock();
    await expect(handlers.batch_protein_lookup({ accessions })).rejects.toThrow('1-25');
  });
  it('caps FASTA batches at ten entries', async () => {
    mock();
    await expect(handlers.batch_protein_lookup({ accessions: Array(11).fill('P04637'), format: 'fasta' })).rejects.toThrow('10');
  });
});
