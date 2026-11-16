// Fields of ChEMBL REST JSON records that the tools read. Unlisted fields pass through untouched.

export interface ChemblActivity {
  assay_chembl_id?: string;
  target_chembl_id?: string;
  molecule_chembl_id?: string;
  standard_type?: string | null;
  standard_value?: string | number | null;
  standard_units?: string | null;
  standard_relation?: string | null;
}

export interface ChemblCrossReference {
  xref_src: string;
  xref_id: string;
  xref_name?: string | null;
}

export interface ChemblMolecule {
  max_phase?: number | string | null;
}

/** Molecule property values; ChEMBL serialises most of them as decimal strings. */
export type ChemblMoleculeProperties = Partial<
  Record<'alogp' | 'full_mwt' | 'hba' | 'hbd' | 'molecular_weight' | 'num_ro5_violations' | 'psa', number | string | null>
>;
