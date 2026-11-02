import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import {
  getClient,
  isValidChemblIdArgs,
  assessAbsorption,
  assessDistribution,
  assessDrugLikenessFromProps,
  assessPermeability,
  getDrugLikenessRecommendation,
} from '../client.js';

export const tools: Tool[] = [
  {
    name: 'analyze_admet_properties',
    description: 'Analyze ADMET properties (Absorption, Distribution, Metabolism, Excretion, Toxicity)',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'calculate_descriptors',
    description: 'Calculate molecular descriptors and physicochemical properties',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
        smiles: { type: 'string', description: 'SMILES string (alternative to ChEMBL ID)' },
      },
      required: [],
    },
  },
  {
    name: 'predict_solubility',
    description: 'Predict aqueous solubility and permeability properties',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
        smiles: { type: 'string', description: 'SMILES string (alternative to ChEMBL ID)' },
      },
      required: [],
    },
  },
  {
    name: 'assess_drug_likeness',
    description: 'Assess drug-likeness using Lipinski Rule of Five and other metrics',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
        smiles: { type: 'string', description: 'SMILES string (alternative to ChEMBL ID)' },
      },
      required: [],
    },
  },
];

async function handleAnalyzeAdmetProperties(args: Record<string, unknown>) {
  if (!isValidChemblIdArgs(args)) {
    throw new Error('Invalid ADMET analysis arguments');
  }

  const client = getClient();
  const response = await client.get(`/molecule/${args.chembl_id}.json`);
  const molecule = response.data;
  const props = molecule.molecule_properties || {};

  return {
    chembl_id: args.chembl_id,
    absorption: {
      molecular_weight: props.full_mwt || props.molecular_weight,
      alogp: props.alogp,
      hbd: props.hbd,
      hba: props.hba,
      psa: props.psa,
      ro3_pass: props.ro3_pass,
      assessment: assessAbsorption(props),
    },
    distribution: {
      logp: props.alogp,
      psa: props.psa,
      assessment: assessDistribution(props),
    },
    drug_likeness: {
      lipinski_violations: props.num_ro5_violations,
      rotatable_bonds: props.rtb,
      aromatic_rings: props.aromatic_rings,
      assessment: assessDrugLikenessFromProps(props),
    },
    molecular_properties: props,
  };
}

async function handleCalculateDescriptors(args: Record<string, unknown>) {
  if (!args || (!args.chembl_id && !args.smiles)) {
    throw new Error('Invalid descriptor calculation arguments');
  }

  if (!args.chembl_id) {
    return {
      message: 'SMILES-based descriptor calculation requires ChEMBL ID',
      smiles: args.smiles,
    };
  }

  const client = getClient();
  const response = await client.get(`/molecule/${args.chembl_id}.json`);
  const molecule = response.data;
  const props = molecule.molecule_properties || {};
  const structures = molecule.molecule_structures || {};

  return {
    chembl_id: molecule.molecule_chembl_id,
    basic_properties: {
      molecular_weight: props.full_mwt || props.molecular_weight,
      exact_mass: props.full_mwt,
      molecular_formula: props.molecular_formula,
    },
    lipophilicity: {
      alogp: props.alogp,
      logp: props.alogp,
    },
    hydrogen_bonding: {
      hbd: props.hbd,
      hba: props.hba,
    },
    polar_surface_area: {
      psa: props.psa,
      tpsa: props.psa,
    },
    complexity: {
      rotatable_bonds: props.rtb,
      aromatic_rings: props.aromatic_rings,
      heavy_atoms: props.heavy_atoms,
      num_atoms: props.num_atoms,
    },
    drug_likeness_metrics: {
      ro5_violations: props.num_ro5_violations,
      ro3_pass: props.ro3_pass,
      cx_logp: props.cx_logp,
      cx_logd: props.cx_logd,
    },
    structures: {
      smiles: structures.canonical_smiles,
      inchi: structures.standard_inchi,
      inchi_key: structures.standard_inchi_key,
    },
  };
}

async function handlePredictSolubility(args: Record<string, unknown>) {
  if (!args || (!args.chembl_id && !args.smiles)) {
    throw new Error('Invalid solubility prediction arguments');
  }

  if (!args.chembl_id) {
    return {
      message: 'SMILES-based solubility prediction requires ChEMBL ID',
      smiles: args.smiles,
    };
  }

  const client = getClient();
  const response = await client.get(`/molecule/${args.chembl_id}.json`);
  const molecule = response.data;
  const props = molecule.molecule_properties || {};

  const logp = props.alogp || 0;
  const psa = props.psa || 0;
  const mw = props.full_mwt || props.molecular_weight || 0;
  const hbd = props.hbd || 0;
  const hba = props.hba || 0;

  let solubilityClass = 'Moderate';
  let permeability = 'Moderate';

  if (logp < 0 && psa > 100) {
    solubilityClass = 'High';
    permeability = 'Low';
  } else if (logp > 5 || psa < 40) {
    solubilityClass = 'Low';
    permeability = 'High';
  } else if (logp > 3 && psa < 70) {
    solubilityClass = 'Low-Moderate';
    permeability = 'High';
  } else if (logp < 2 && psa > 80) {
    solubilityClass = 'Moderate-High';
    permeability = 'Low-Moderate';
  }

  return {
    chembl_id: molecule.molecule_chembl_id,
    aqueous_solubility: {
      predicted_class: solubilityClass,
      logp,
      psa,
      factors: {
        lipophilicity: logp > 3 ? 'High (reduces solubility)' : 'Moderate',
        polar_surface_area: psa > 100 ? 'High (increases solubility)' : 'Moderate',
        hydrogen_bonding: `${hbd} donors, ${hba} acceptors`,
      },
    },
    permeability: {
      predicted_class: permeability,
      assessment: assessPermeability(props),
    },
    molecular_properties: {
      molecular_weight: mw,
      alogp: logp,
      psa,
      hbd,
      hba,
    },
  };
}

async function handleAssessDrugLikeness(args: Record<string, unknown>) {
  if (!args || (!args.chembl_id && !args.smiles)) {
    throw new Error('Invalid drug-likeness assessment arguments');
  }

  if (!args.chembl_id) {
    return {
      message: 'SMILES-based drug-likeness assessment requires ChEMBL ID',
      smiles: args.smiles,
    };
  }

  const client = getClient();
  const response = await client.get(`/molecule/${args.chembl_id}.json`);
  const molecule = response.data;
  const props = molecule.molecule_properties || {};

  const mw = props.full_mwt || props.molecular_weight || 0;
  const logp = props.alogp || 0;
  const hbd = props.hbd || 0;
  const hba = props.hba || 0;

  const lipinskiViolations = [
    mw > 500 ? 'Molecular weight > 500 Da' : null,
    logp > 5 ? 'LogP > 5' : null,
    hbd > 5 ? 'H-bond donors > 5' : null,
    hba > 10 ? 'H-bond acceptors > 10' : null,
  ].filter((v): v is string => v !== null);

  const rtb = props.rtb || 0;
  const psa = props.psa || 0;
  const veberPass = rtb <= 10 && psa <= 140;

  return {
    chembl_id: molecule.molecule_chembl_id,
    lipinski_rule_of_five: {
      violations: lipinskiViolations.length,
      details: lipinskiViolations.length > 0 ? lipinskiViolations : ['All criteria met'],
      pass: lipinskiViolations.length === 0,
      criteria: {
        molecular_weight: { value: mw, limit: 500, pass: mw <= 500 },
        logp: { value: logp, limit: 5, pass: logp <= 5 },
        hbd: { value: hbd, limit: 5, pass: hbd <= 5 },
        hba: { value: hba, limit: 10, pass: hba <= 10 },
      },
    },
    veber_rules: {
      pass: veberPass,
      criteria: {
        rotatable_bonds: { value: rtb, limit: 10, pass: rtb <= 10 },
        psa: { value: psa, limit: 140, pass: psa <= 140 },
      },
    },
    overall_assessment: {
      drug_likeness:
        lipinskiViolations.length === 0 ? 'Excellent' : lipinskiViolations.length === 1 ? 'Good' : 'Poor',
      oral_bioavailability: veberPass && lipinskiViolations.length <= 1 ? 'Likely' : 'Uncertain',
      recommendation: getDrugLikenessRecommendation(lipinskiViolations.length, veberPass),
    },
    molecular_properties: props,
  };
}

export const handlers: Record<string, ToolHandler> = {
  analyze_admet_properties: handleAnalyzeAdmetProperties,
  calculate_descriptors: handleCalculateDescriptors,
  predict_solubility: handlePredictSolubility,
  assess_drug_likeness: handleAssessDrugLikeness,
};
