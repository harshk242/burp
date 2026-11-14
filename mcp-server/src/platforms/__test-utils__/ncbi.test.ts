import { describe, expect, it } from 'vitest';
import { assertNcbiFieldsMatch, ncbiFields } from './ncbi.js';

const fields = [{ name: 'GENE', fullname: 'Gene' }, { name: 'ALL', fullname: 'All Fields' }];
const { assertFieldTags, assertSearchAccepted } = ncbiFields(fields, { symbol: 'gene' });
const xml = (translation: string, extra = '') => `<eSearchResult><Count>1</Count><QueryTranslation>${translation}</QueryTranslation>${extra}</eSearchResult>`;
it('resolves names, full names and explicit database aliases', () => {
  assertFieldTags('TP53[GENE] OR TP53[symbol]');
  assertSearchAccepted(xml('TP53[Gene]'), 'TP53[symbol]', true);
  expect(() => assertFieldTags('TP53[invalid]')).toThrow();
});
describe.each(['ERROR', 'ErrorList', 'WarningList', 'errorlist', 'warninglist'])('%s', key => {
  it('rejects HTTP-success responses that report ignored parameters', () => {
    expect(() => assertSearchAccepted(xml('TP53[Gene]', `<${key}>ignored</${key}>`), 'TP53[gene]')).toThrow();
  });
});
it('detects dropped fields even in mixed free-text queries', () => {
  assertSearchAccepted(xml('TP53[Gene] AND cancer[All Fields]'), 'TP53[gene] AND cancer');
  expect(() => assertSearchAccepted(xml('TP53[All Fields] AND cancer[All Fields]'), 'TP53[gene] AND cancer')).toThrow();
  expect(() => assertSearchAccepted(xml('TP53[Gene] OR TP53[All Fields]'), 'TP53[gene]', true)).toThrow();
});
it('compares all EInfo fields without depending on ordering or extra metadata', () => {
  assertNcbiFieldsMatch([...fields].reverse(), fields);
  expect(() => assertNcbiFieldsMatch([...fields, { name: 'NEW', fullname: 'New' }], fields)).toThrow();
});
