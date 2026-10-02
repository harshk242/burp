import { describe, expect, it } from 'vitest';
import { compareSchemas, extractSchema } from './schema-validator.js';

describe('schema validator heterogeneous arrays', () => {
  it('records mixed primitive values as an explicit union', () => {
    const schema = extractSchema([{ units: null }, { units: 'nM' }]);
    const units = schema.items?.properties?.units;

    expect(units).toMatchObject({
      type: 'union',
      variants: [{ type: 'null' }, { type: 'string' }],
    });
  });

  it.each([null, 'nM'])('accepts a recorded primitive variant: %j', (unit) => {
    const baseline = extractSchema([{ units: null }, { units: 'nM' }]);
    const current = extractSchema([{ units: unit }]);

    expect(compareSchemas(baseline, current)).toEqual({
      removedKeys: [],
      typeChanges: [],
      addedKeys: [],
    });
  });

  it.each([
    [42, 'number'],
    [{}, 'object'],
    [[], 'array'],
  ])('rejects an unrecorded variant: %j', (unit, type) => {
    const baseline = extractSchema([{ units: null }, { units: 'nM' }]);
    const current = extractSchema([{ units: unit }]);

    expect(compareSchemas(baseline, current).typeChanges).toEqual([
      `$[].units: was one of 'null' | 'string', now '${type}'`,
    ]);
  });

  it('continues recursive validation for an object union variant', () => {
    const baseline = extractSchema([{ value: null }, { value: { stable: 'yes' } }]);
    const current = extractSchema([{ value: { stable: 'yes', added: true } }]);

    expect(compareSchemas(baseline, current)).toEqual({
      removedKeys: [],
      typeChanges: [],
      addedKeys: ['$[].value.added'],
    });
  });

  it('merges repeated object variants without losing optional-key information', () => {
    const schema = extractSchema([
      { value: null },
      { value: { required: 'yes' } },
      { value: { required: 'yes', sparse: true } },
    ]);
    const value = schema.items?.properties?.value;
    const objectVariant = value?.variants?.find((variant) => variant.type === 'object');

    expect(objectVariant?.properties?.sparse).toMatchObject({
      type: 'boolean',
      optional: true,
    });
  });

  it('rejects a new variant when the current sample is also heterogeneous', () => {
    const baseline = extractSchema([{ units: null }, { units: 'nM' }]);
    const current = extractSchema([{ units: null }, { units: 'nM' }, { units: 42 }]);

    expect(compareSchemas(baseline, current).typeChanges).toEqual([
      "$[].units: was one of 'null' | 'string', now 'number'",
    ]);
  });

  it('preserves optional-key semantics alongside a union field', () => {
    const baseline = extractSchema([
      { units: null, only_in_some_records: true },
      { units: 'nM' },
    ]);
    const current = extractSchema([{ units: 'nM' }]);

    expect(compareSchemas(baseline, current)).toEqual({
      removedKeys: [],
      typeChanges: [],
      addedKeys: [],
    });
  });

  it('does not treat truly unknown values as a wildcard', () => {
    const baseline = extractSchema(undefined);
    const current = extractSchema('nM');

    expect(compareSchemas(baseline, current).typeChanges).toEqual([
      "$: was 'unknown', now 'string'",
    ]);
  });
});

describe('schema validator nullable paths', () => {
  const nullablePaths = new Set(['$.hits[].description']);
  const noDrift = { removedKeys: [], typeChanges: [], addedKeys: [] };

  it('rejects null drift on a path not declared nullable', () => {
    const baseline = extractSchema({ hits: [{ description: 'text' }] });
    const current = extractSchema({ hits: [{ description: null }] });

    expect(compareSchemas(baseline, current).typeChanges).toEqual([
      "$.hits[].description: was 'string', now 'null'",
    ]);
  });

  it('tolerates a value becoming null on a nullable path', () => {
    const baseline = extractSchema({ hits: [{ description: 'text' }] });
    const current = extractSchema({ hits: [{ description: null }] });

    expect(compareSchemas(baseline, current, { nullablePaths })).toEqual(noDrift);
  });

  it('tolerates a null baseline gaining a value on a nullable path', () => {
    const baseline = extractSchema({ hits: [{ description: null }] });
    const current = extractSchema({ hits: [{ description: 'text' }] });

    expect(compareSchemas(baseline, current, { nullablePaths })).toEqual(noDrift);
  });

  it('tolerates null among heterogeneous current samples', () => {
    const baseline = extractSchema({ hits: [{ description: 'text' }] });
    const current = extractSchema({ hits: [{ description: 'text' }, { description: null }] });

    expect(compareSchemas(baseline, current, { nullablePaths })).toEqual(noDrift);
  });

  it('tolerates null against a union baseline without a null variant', () => {
    const baseline = extractSchema({ hits: [{ description: 'text' }, { description: 1 }] });
    const current = extractSchema({ hits: [{ description: null }] });

    expect(compareSchemas(baseline, current, { nullablePaths })).toEqual(noDrift);
  });

  it('still rejects non-null type changes on a nullable path', () => {
    const baseline = extractSchema({ hits: [{ description: 'text' }] });
    const current = extractSchema({ hits: [{ description: 42 }] });

    expect(compareSchemas(baseline, current, { nullablePaths }).typeChanges).toEqual([
      "$.hits[].description: was 'string', now 'number'",
    ]);
  });

  it('still rejects an unrecorded non-null variant against a nullable union baseline', () => {
    const baseline = extractSchema({ hits: [{ description: null }, { description: 'text' }] });
    const current = extractSchema({ hits: [{ description: 42 }] });

    expect(compareSchemas(baseline, current, { nullablePaths }).typeChanges).toEqual([
      "$.hits[].description: was one of 'null' | 'string', now 'number'",
    ]);
  });
});
