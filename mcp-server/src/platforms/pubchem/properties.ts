import { path, recordArray } from '../../shared/json.js';

/** Property tags documented at https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest#section=Compound-Property-Tables */
export const PROPERTY_NAMES = [
  'MolecularFormula', 'MolecularWeight', 'CanonicalSMILES', 'IsomericSMILES',
  'ConnectivitySMILES', 'SMILES', 'InChI', 'InChIKey', 'IUPACName', 'XLogP',
  'ExactMass', 'MonoisotopicMass', 'TPSA', 'Complexity', 'Charge',
  'HBondDonorCount', 'HBondAcceptorCount', 'RotatableBondCount', 'HeavyAtomCount',
  'IsotopeAtomCount', 'AtomStereoCount', 'DefinedAtomStereoCount', 'UndefinedAtomStereoCount',
  'BondStereoCount', 'DefinedBondStereoCount', 'UndefinedBondStereoCount',
  'CovalentUnitCount', 'Volume3D', 'ConformerCount3D',
  'XStericQuadrupole3D', 'YStericQuadrupole3D', 'ZStericQuadrupole3D',
  'FeatureCount3D', 'FeatureAcceptorCount3D', 'FeatureDonorCount3D',
  'FeatureAnionCount3D', 'FeatureCationCount3D', 'FeatureRingCount3D',
  'FeatureHydrophobeCount3D', 'ConformerModelRMSD3D', 'EffectiveRotorCount3D', 'Fingerprint2D',
];

export function normalizeProperties<T>(data: T): T {
  for (const row of recordArray(path(data, 'PropertyTable', 'Properties'))) {
    if (row.ConnectivitySMILES) row.CanonicalSMILES ??= row.ConnectivitySMILES;
    if (row.SMILES) row.IsomericSMILES ??= row.SMILES;
  }
  return data;
}
