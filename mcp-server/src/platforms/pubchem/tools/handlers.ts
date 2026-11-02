import type { ToolHandler } from '../../../types.js';
import { getClient } from '../client.js';
import { compoundDescriptions, compoundRecord } from '../endpoints.js';
import {
  isValidBatchArgs,
  isValidCidArgs,
  isValidCompoundSearchArgs,
  isValidConformerArgs,
  isValidPropertiesArgs,
  isValidSmilesArgs,
} from '../types.js';

const handleSearchCompounds: ToolHandler = async (args) => {
  if (!isValidCompoundSearchArgs(args)) {
    throw new Error('Invalid compound search arguments');
  }

  const searchType = args.search_type || 'name';
  const maxRecords = args.max_records || 100;
  const api = getClient();

  const response = await api.get(
    `/compound/${searchType}/${encodeURIComponent(args.query)}/cids/JSON`,
    { params: { MaxRecords: maxRecords } },
  );

  if (response.data?.IdentifierList?.CID?.length > 0) {
    const cids = response.data.IdentifierList.CID.slice(0, 10);
    const detailsResponse = await api.get(
      `/compound/cid/${cids.join(',')}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`,
    );
    return {
      query: args.query,
      search_type: searchType,
      total_found: response.data.IdentifierList.CID.length,
      details: detailsResponse.data,
    };
  }

  return { message: 'No compounds found', query: args.query };
};

const handleGetCompoundInfo: ToolHandler = async (args) => {
  if (!isValidCidArgs(args)) {
    throw new Error('Invalid CID arguments');
  }

  const format = args.format || 'json';
  const api = getClient();
  const response = await api.get(compoundRecord(args.cid, format === 'json' ? 'JSON' : format));
  const record = format === 'json' ? response.data : String(response.data);

  if (!args.include_descriptions) {
    return record;
  }

  const descriptionsResponse = await api.get(compoundDescriptions(args.cid));
  return { record, descriptions: descriptionsResponse.data };
};

const handleSearchBySmiles: ToolHandler = async (args) => {
  if (!isValidSmilesArgs(args)) {
    throw new Error('Invalid SMILES arguments');
  }

  const api = getClient();
  const response = await api.get(
    `/compound/smiles/${encodeURIComponent(args.smiles)}/cids/JSON`,
  );

  if (response.data?.IdentifierList?.CID?.length > 0) {
    const cid = response.data.IdentifierList.CID[0];
    const detailsResponse = await api.get(
      `/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`,
    );
    return {
      query_smiles: args.smiles,
      found_cid: cid,
      details: detailsResponse.data,
    };
  }

  return { message: 'No exact match found', query_smiles: args.smiles };
};

const handleSearchByInchi: ToolHandler = async (args) => {
  return { message: 'InChI search not yet implemented', args };
};

const handleSearchByCasNumber: ToolHandler = async (args) => {
  return { message: 'CAS search not yet implemented', args };
};

const handleGetCompoundSynonyms: ToolHandler = async (args) => {
  if (!isValidCidArgs(args)) {
    throw new Error('Invalid CID arguments');
  }

  const api = getClient();
  const response = await api.get(`/compound/cid/${args.cid}/synonyms/JSON`);
  return response.data;
};

const handleSearchSimilarCompounds: ToolHandler = async (args) => {
  if (!isValidSmilesArgs(args)) {
    throw new Error('Invalid similarity search arguments');
  }

  const threshold = args.threshold || 90;
  const maxRecords = args.max_records || 100;
  const api = getClient();

  const response = await api.post('/compound/similarity/smiles/JSON', {
    smiles: args.smiles,
    Threshold: threshold,
    MaxRecords: maxRecords,
  });

  return response.data;
};

const handleSubstructureSearch: ToolHandler = async (args) => {
  return { message: 'Substructure search not yet implemented', args };
};

const handleSuperstructureSearch: ToolHandler = async (args) => {
  return { message: 'Superstructure search not yet implemented', args };
};

const handleGet3dConformers: ToolHandler = async (args) => {
  if (!isValidConformerArgs(args)) {
    throw new Error('Invalid 3D conformer arguments');
  }

  const api = getClient();
  const response = await api.get(
    `/compound/cid/${args.cid}/property/Volume3D,ConformerCount3D/JSON`,
  );

  return {
    cid: args.cid,
    conformer_type: args.conformer_type || '3d',
    properties: response.data,
  };
};

const handleAnalyzeStereochemistry: ToolHandler = async (args) => {
  if (!isValidCidArgs(args)) {
    throw new Error('Invalid stereochemistry arguments');
  }

  const api = getClient();
  const response = await api.get(
    `/compound/cid/${args.cid}/property/AtomStereoCount,DefinedAtomStereoCount,BondStereoCount,DefinedBondStereoCount,IsomericSMILES/JSON`,
  );

  return { cid: args.cid, stereochemistry: response.data };
};

const handleGetCompoundProperties: ToolHandler = async (args) => {
  if (!isValidPropertiesArgs(args)) {
    throw new Error('Invalid compound properties arguments');
  }

  const properties = args.properties || [
    'MolecularWeight', 'XLogP', 'TPSA', 'HBondDonorCount', 'HBondAcceptorCount',
    'RotatableBondCount', 'Complexity', 'HeavyAtomCount', 'Charge',
  ];

  const api = getClient();
  const response = await api.get(
    `/compound/cid/${args.cid}/property/${properties.join(',')}/JSON`,
  );

  return response.data;
};

const handleCalculateDescriptors: ToolHandler = async (args) => {
  return { message: 'Descriptor calculation not yet implemented', args };
};

const handlePredictAdmetProperties: ToolHandler = async (args) => {
  return { message: 'ADMET prediction not yet implemented', args };
};

const handleAssessDrugLikeness: ToolHandler = async (args) => {
  return { message: 'Drug-likeness assessment not yet implemented', args };
};

const handleAnalyzeMolecularComplexity: ToolHandler = async (args) => {
  return { message: 'Molecular complexity analysis not yet implemented', args };
};

const handleGetPharmacophoreFeatures: ToolHandler = async (args) => {
  return { message: 'Pharmacophore features not yet implemented', args };
};

const handleSearchBioassays: ToolHandler = async (args) => {
  return { message: 'Bioassay search not yet implemented', args };
};

const handleGetAssayInfo: ToolHandler = async (args) => {
  const a = args as Record<string, unknown>;
  const api = getClient();
  const response = await api.get(`/assay/aid/${a.aid}/JSON`);
  return response.data;
};

const handleGetCompoundBioactivities: ToolHandler = async (args) => {
  return { message: 'Bioactivity search not yet implemented', args };
};

const handleSearchByTarget: ToolHandler = async (args) => {
  return { message: 'Target search not yet implemented', args };
};

const handleCompareActivityProfiles: ToolHandler = async (args) => {
  return { message: 'Activity profile comparison not yet implemented', args };
};

const handleGetSafetyData: ToolHandler = async (args) => {
  if (!isValidCidArgs(args)) {
    throw new Error('Invalid CID arguments');
  }

  const api = getClient();
  const response = await api.get(`/compound/cid/${args.cid}/classification/JSON`);
  return response.data;
};

const handleGetToxicityInfo: ToolHandler = async (args) => {
  return { message: 'Toxicity info not yet implemented', args };
};

const handleAssessEnvironmentalFate: ToolHandler = async (args) => {
  return { message: 'Environmental fate assessment not yet implemented', args };
};

const handleGetRegulatoryInfo: ToolHandler = async (args) => {
  return { message: 'Regulatory info not yet implemented', args };
};

const handleGetExternalReferences: ToolHandler = async (args) => {
  return { message: 'External references not yet implemented', args };
};

const handleSearchPatents: ToolHandler = async (args) => {
  return { message: 'Patent search not yet implemented', args };
};

const handleGetLiteratureReferences: ToolHandler = async (args) => {
  return { message: 'Literature references not yet implemented', args };
};

const handleBatchCompoundLookup: ToolHandler = async (args) => {
  if (!isValidBatchArgs(args)) {
    throw new Error('Invalid batch arguments');
  }

  const api = getClient();
  const results = [];

  for (const cid of args.cids.slice(0, 10)) {
    try {
      const response = await api.get(
        `/compound/cid/${cid}/property/MolecularWeight,CanonicalSMILES,IUPACName/JSON`,
      );
      results.push({ cid, data: response.data, success: true });
    } catch (error) {
      results.push({
        cid,
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      });
    }
  }

  return { batch_results: results };
};

export const handlers: Record<string, ToolHandler> = {
  search_compounds: handleSearchCompounds,
  get_compound_info: handleGetCompoundInfo,
  search_by_smiles: handleSearchBySmiles,
  search_by_inchi: handleSearchByInchi,
  search_by_cas_number: handleSearchByCasNumber,
  get_compound_synonyms: handleGetCompoundSynonyms,
  search_similar_compounds: handleSearchSimilarCompounds,
  substructure_search: handleSubstructureSearch,
  superstructure_search: handleSuperstructureSearch,
  get_3d_conformers: handleGet3dConformers,
  analyze_stereochemistry: handleAnalyzeStereochemistry,
  get_compound_properties: handleGetCompoundProperties,
  calculate_descriptors: handleCalculateDescriptors,
  predict_admet_properties: handlePredictAdmetProperties,
  assess_drug_likeness: handleAssessDrugLikeness,
  analyze_molecular_complexity: handleAnalyzeMolecularComplexity,
  get_pharmacophore_features: handleGetPharmacophoreFeatures,
  search_bioassays: handleSearchBioassays,
  get_assay_info: handleGetAssayInfo,
  get_compound_bioactivities: handleGetCompoundBioactivities,
  search_by_target: handleSearchByTarget,
  compare_activity_profiles: handleCompareActivityProfiles,
  get_safety_data: handleGetSafetyData,
  get_toxicity_info: handleGetToxicityInfo,
  assess_environmental_fate: handleAssessEnvironmentalFate,
  get_regulatory_info: handleGetRegulatoryInfo,
  get_external_references: handleGetExternalReferences,
  search_patents: handleSearchPatents,
  get_literature_references: handleGetLiteratureReferences,
  batch_compound_lookup: handleBatchCompoundLookup,
};
