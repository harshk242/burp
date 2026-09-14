import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../client.js', () => ({
  getClient: () => ({ get: mockGet }),
}));

import { tools } from '../tools/definitions.js';
import { handlers } from '../tools/handlers.js';
import { isValidCidArgs } from '../types.js';

describe('get_compound_info', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('returns the existing record response when descriptions are not requested', async () => {
    const record = { PC_Compounds: [{ id: { id: { cid: 2244 } } }] };
    mockGet.mockResolvedValueOnce({ data: record });

    await expect(handlers.get_compound_info({ cid: 2244 })).resolves.toBe(record);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/JSON',
    );
  });

  it('returns the record and descriptions when requested', async () => {
    const record = { PC_Compounds: [{ id: { id: { cid: 2244 } } }] };
    const descriptions = { InformationList: { Information: [{ CID: 2244, Title: 'Aspirin' }] } };
    mockGet.mockResolvedValueOnce({ data: record }).mockResolvedValueOnce({ data: descriptions });

    await expect(
      handlers.get_compound_info({ cid: 2244, include_descriptions: true }),
    ).resolves.toEqual({ record, descriptions });
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/description/',
    );
  });

  it('propagates a description request failure after retrieving the record', async () => {
    const descriptionFailure = new Error('description request failed');
    mockGet.mockResolvedValueOnce({ data: { PC_Compounds: [] } }).mockRejectedValueOnce(descriptionFailure);

    await expect(
      handlers.get_compound_info({ cid: 2244, include_descriptions: true }),
    ).rejects.toBe(descriptionFailure);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

describe('get_compound_info descriptions argument', () => {
  it('accepts an optional boolean and rejects other values', () => {
    expect(isValidCidArgs({ cid: 2244 })).toBe(true);
    expect(isValidCidArgs({ cid: 2244, include_descriptions: true })).toBe(true);
    expect(isValidCidArgs({ cid: 2244, include_descriptions: 'true' })).toBe(false);
  });

  it('exposes include_descriptions in the tool definition', () => {
    const definition = tools.find((tool) => tool.name === 'get_compound_info');

    expect(definition).toMatchObject({
      inputSchema: {
        properties: {
          include_descriptions: { type: 'boolean' },
        },
      },
    });
  });
});
