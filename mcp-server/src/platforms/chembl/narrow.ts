import type { JsonRecord } from '../../shared/json.js';
import type { ChemblMoleculeProperties } from './types.js';

const PROPERTY_KEYS = [
  'alogp',
  'full_mwt',
  'hba',
  'hbd',
  'molecular_weight',
  'num_ro5_violations',
  'psa',
  'rtb',
] as const satisfies ReadonlyArray<keyof ChemblMoleculeProperties>;

function isPropertyValue(value: unknown): value is number | string | null {
  return value === null || typeof value === 'number' || typeof value === 'string';
}

/**
 * The numeric molecule properties the assessments read, kept as ChEMBL serialises them
 * (decimal strings or numbers); values of any other type are dropped.
 */
export function moleculeProperties(record: JsonRecord): ChemblMoleculeProperties {
  const props: ChemblMoleculeProperties = {};
  for (const key of PROPERTY_KEYS) {
    const value = record[key];
    if (isPropertyValue(value)) props[key] = value;
  }
  return props;
}
