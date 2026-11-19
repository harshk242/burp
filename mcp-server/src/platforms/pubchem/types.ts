import { isRecord } from '../../shared/json.js';
import { PROPERTY_NAMES } from './properties.js';

export interface CompoundSearchResult {
  IdentifierList: {
    CID: number[];
  };
}

export interface PropertyData {
  PropertyTable: {
    Properties: Array<{
      CID: number;
      MolecularFormula?: string;
      MolecularWeight?: number;
      CanonicalSMILES?: string;
      ConnectivitySMILES?: string;
      SMILES?: string;
      IsomericSMILES?: string;
      InChI?: string;
      InChIKey?: string;
      IUPACName?: string;
      XLogP?: number;
      TPSA?: number;
      Complexity?: number;
      Charge?: number;
      HBondDonorCount?: number;
      HBondAcceptorCount?: number;
      RotatableBondCount?: number;
      HeavyAtomCount?: number;
      AtomStereoCount?: number;
      DefinedAtomStereoCount?: number;
      BondStereoCount?: number;
      DefinedBondStereoCount?: number;
      Volume3D?: number;
      ConformerCount3D?: number;
    }>;
  };
}

export const isValidCompoundSearchArgs = (
  args: unknown,
): args is { query: string; search_type?: string; max_records?: number } => {
  if (!isRecord(args)) return false;
  const a = args;
  return (
    typeof a.query === 'string' &&
    (a.query).length > 0 &&
    (a.search_type === undefined ||
      (typeof a.search_type === 'string' &&
        ['name', 'smiles', 'inchi', 'sdf', 'cid', 'formula'].includes(a.search_type))) &&
    (a.max_records === undefined ||
      (typeof a.max_records === 'number' && a.max_records > 0 && a.max_records <= 10000))
  );
};

export const isValidCidArgs = (
  args: unknown,
): args is { cid: number | string; format?: string; include_descriptions?: boolean } => {
  if (!isRecord(args)) return false;
  const a = args;
  return (
    (typeof a.cid === 'number' || typeof a.cid === 'string') &&
    (a.format === undefined ||
      (typeof a.format === 'string' && ['json', 'sdf', 'xml', 'asnt', 'asnb'].includes(a.format))) &&
    (a.include_descriptions === undefined || typeof a.include_descriptions === 'boolean')
  );
};

export const isValidSmilesArgs = (
  args: unknown,
): args is { smiles: string; threshold?: number; max_records?: number } => {
  if (!isRecord(args)) return false;
  const a = args;
  return (
    typeof a.smiles === 'string' &&
    (a.smiles).length > 0 &&
    (a.threshold === undefined ||
      (typeof a.threshold === 'number' && a.threshold >= 0 && a.threshold <= 100)) &&
    (a.max_records === undefined ||
      (typeof a.max_records === 'number' && a.max_records > 0 && a.max_records <= 10000))
  );
};

export const isValidBatchArgs = (
  args: unknown,
): args is { cids: number[]; operation?: string } => {
  if (!isRecord(args)) return false;
  const a = args;
  return (
    Array.isArray(a.cids) &&
    a.cids.length > 0 &&
    a.cids.length <= 200 &&
    a.cids.every((cid: unknown) => typeof cid === 'number' && (cid) > 0) &&
    (a.operation === undefined ||
      (typeof a.operation === 'string' &&
        ['property', 'synonyms', 'classification', 'description'].includes(a.operation)))
  );
};

export const isValidConformerArgs = (
  args: unknown,
): args is { cid: number | string } => {
  if (!isRecord(args)) return false;
  const a = args;
  return (
    (typeof a.cid === 'number' || typeof a.cid === 'string')
  );
};

export const isValidPropertiesArgs = (
  args: unknown,
): args is { cid: number | string; properties?: string[] } => {
  if (!isRecord(args)) return false;
  const a = args;
  return (
    (typeof a.cid === 'number' || typeof a.cid === 'string') &&
    (a.properties === undefined ||
      (Array.isArray(a.properties) &&
        a.properties.length > 0 && a.properties.every((p: unknown) => typeof p === 'string' && PROPERTY_NAMES.includes(p))))
  );
};
