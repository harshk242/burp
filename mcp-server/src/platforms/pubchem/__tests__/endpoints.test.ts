import { describe, expect, it } from 'vitest';
import { compoundDescriptions, compoundRecord } from '../endpoints.js';

describe('PubChem endpoint builders', () => {
  it('builds a compound record URL', () => {
    expect(compoundRecord(2244)).toBe(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/JSON',
    );
  });

  it('encodes CIDs in record and description URLs', () => {
    const cid = '2244/alternate id';

    expect(compoundRecord(cid)).toBe(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244%2Falternate%20id/JSON',
    );
    expect(compoundDescriptions(cid)).toBe(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244%2Falternate%20id/description/',
    );
  });
});
