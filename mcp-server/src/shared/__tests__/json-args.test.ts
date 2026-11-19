import { describe, expect, it } from 'vitest';

import {
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireNumber,
  requireString,
} from '../args.js';
import { ValidationError } from '../exceptions.js';
import {
  asArray,
  asRecord,
  isRecord,
  optNumber,
  optNumeric,
  optText,
  path,
  recordArray,
  recordList,
  stringArray,
} from '../json.js';

describe('json readers', () => {
  it('narrows objects and arrays', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(asRecord('x')).toEqual({});
    expect(asArray({})).toEqual([]);
    expect(recordArray([{ a: 1 }, 2, null, [3]])).toEqual([{ a: 1 }]);
    expect(stringArray(['a', 1, 'b'])).toEqual(['a', 'b']);
  });

  it('treats a single XML child and a repeated one alike', () => {
    expect(recordList({ a: 1 })).toEqual([{ a: 1 }]);
    expect(recordList([{ a: 1 }, 'x'])).toEqual([{ a: 1 }]);
    expect(recordList(undefined)).toEqual([]);
  });

  it('reads scalars', () => {
    expect(optNumber(Number.NaN)).toBeUndefined();
    expect(optNumeric('3.5')).toBe(3.5);
    expect(optNumeric('')).toBeUndefined();
    expect(optNumeric('abc')).toBeUndefined();
    expect(optText(42)).toBe('42');
    expect(optText(true)).toBeUndefined();
  });

  it('walks nested paths', () => {
    expect(path({ a: { b: 1 } }, 'a', 'b')).toBe(1);
    expect(path({ a: [1] }, 'a', 'b')).toBeUndefined();
  });
});

describe('tool argument readers', () => {
  it('requires non-empty strings', () => {
    expect(requireString({ id: 'X' }, 'id')).toBe('X');
    expect(() => requireString({ id: '' }, 'id')).toThrow(ValidationError);
    expect(() => requireString({}, 'id')).toThrow('Invalid argument "id"');
  });

  it('reads optional values and rejects wrong types', () => {
    expect(optionalString({}, 'q')).toBeUndefined();
    expect(optionalString({ q: null }, 'q')).toBeUndefined();
    expect(() => optionalString({ q: 1 }, 'q')).toThrow(ValidationError);
    expect(optionalNumber({ n: '10' }, 'n')).toBe(10);
    expect(() => optionalNumber({ n: 'ten' }, 'n')).toThrow(ValidationError);
    expect(() => requireNumber({}, 'n')).toThrow(ValidationError);
    expect(optionalBoolean({ b: 'false' }, 'b')).toBe(false);
    expect(optionalStringArray({ ids: ['a'] }, 'ids')).toEqual(['a']);
    expect(() => optionalStringArray({ ids: ['a', 1] }, 'ids')).toThrow(ValidationError);
  });

  it('restricts enums', () => {
    expect(optionalEnum({ t: 'gene' }, 't', ['gene', 'protein'])).toBe('gene');
    expect(() => optionalEnum({ t: 'x' }, 't', ['gene', 'protein'])).toThrow('one of gene, protein');
  });
});
