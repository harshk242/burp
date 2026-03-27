// PubChem API response interfaces

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

// ── Argument validation helpers ──────────────────────────────────────────────

export const isValidCompoundSearchArgs = (
  args: unknown,
): args is { query: string; search_type?: string; max_records?: number } => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return (
    typeof a.query === 'string' &&
    (a.query as string).length > 0 &&
    (a.search_type === undefined ||
      ['name', 'smiles', 'inchi', 'sdf', 'cid', 'formula'].includes(a.search_type as string)) &&
    (a.max_records === undefined ||
      (typeof a.max_records === 'number' && a.max_records > 0 && a.max_records <= 10000))
  );
};

export const isValidCidArgs = (
  args: unknown,
): args is { cid: number | string; format?: string } => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return (
    (typeof a.cid === 'number' || typeof a.cid === 'string') &&
    (a.format === undefined ||
      ['json', 'sdf', 'xml', 'asnt', 'asnb'].includes(a.format as string))
  );
};

export const isValidSmilesArgs = (
  args: unknown,
): args is { smiles: string; threshold?: number; max_records?: number } => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return (
    typeof a.smiles === 'string' &&
    (a.smiles as string).length > 0 &&
    (a.threshold === undefined ||
      (typeof a.threshold === 'number' && a.threshold >= 0 && a.threshold <= 100)) &&
    (a.max_records === undefined ||
      (typeof a.max_records === 'number' && a.max_records > 0 && a.max_records <= 10000))
  );
};

export const isValidBatchArgs = (
  args: unknown,
): args is { cids: number[]; operation?: string } => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return (
    Array.isArray(a.cids) &&
    a.cids.length > 0 &&
    a.cids.length <= 200 &&
    a.cids.every((cid: unknown) => typeof cid === 'number' && (cid as number) > 0) &&
    (a.operation === undefined ||
      ['property', 'synonyms', 'classification', 'description'].includes(a.operation as string))
  );
};

export const isValidConformerArgs = (
  args: unknown,
): args is { cid: number | string; conformer_type?: string } => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return (
    (typeof a.cid === 'number' || typeof a.cid === 'string') &&
    (a.conformer_type === undefined || ['3d', '2d'].includes(a.conformer_type as string))
  );
};

export const isValidPropertiesArgs = (
  args: unknown,
): args is { cid: number | string; properties?: string[] } => {
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return (
    (typeof a.cid === 'number' || typeof a.cid === 'string') &&
    (a.properties === undefined ||
      (Array.isArray(a.properties) &&
        a.properties.every((p: unknown) => typeof p === 'string')))
  );
};
