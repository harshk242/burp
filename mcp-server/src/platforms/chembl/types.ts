// Fields of ChEMBL REST JSON records that the tools compute with. Unlisted fields pass through untouched.

/** Molecule property values; ChEMBL serialises most of them as decimal strings. */
export type ChemblMoleculeProperties = Partial<
  Record<
    'alogp' | 'full_mwt' | 'hba' | 'hbd' | 'molecular_weight' | 'num_ro5_violations' | 'psa' | 'rtb',
    number | string | null
  >
>;
