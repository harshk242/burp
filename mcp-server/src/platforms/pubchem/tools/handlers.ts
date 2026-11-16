import { normalizeProperties } from '../properties.js';
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

  const response = ['smiles', 'inchi', 'sdf'].includes(searchType)
    ? await api.post(`/compound/${searchType}/cids/JSON`,
      new URLSearchParams({ [searchType]: args.query }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    : await api.get(`/compound/${searchType === 'formula' ? 'fastformula' : searchType}/${encodeURIComponent(args.query)}/cids/JSON`);
  if (response.data?.IdentifierList?.CID) {
    response.data.IdentifierList.CID = response.data.IdentifierList.CID.slice(0, maxRecords);
  }

  if (response.data?.IdentifierList?.CID?.length > 0) {
    const cids = response.data.IdentifierList.CID.slice(0, 10);
    const detailsResponse = await api.get(
      `/compound/cid/${cids.join(',')}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`,
    );
    return {
      query: args.query,
      search_type: searchType,
      total_found: response.data.IdentifierList.CID.length,
      details: normalizeProperties(detailsResponse.data),
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
  const response = await api.post('/compound/smiles/cids/JSON',
    new URLSearchParams({ smiles: args.smiles }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  if (response.data?.IdentifierList?.CID?.length > 0) {
    const cid = response.data.IdentifierList.CID[0];
    const detailsResponse = await api.get(
      `/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`,
    );
    return {
      query_smiles: args.smiles,
      found_cid: cid,
      details: normalizeProperties(detailsResponse.data),
    };
  }

  return { message: 'No exact match found', query_smiles: args.smiles };
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

  const threshold = args.threshold ?? 90;
  const maxRecords = args.max_records || 100;
  const api = getClient();

  const response = await api.post('/compound/fastsimilarity_2d/smiles/cids/JSON',
    new URLSearchParams({ smiles: args.smiles }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      params: { Threshold: threshold, MaxRecords: maxRecords },
    });

  return response.data;
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

  return { cid: args.cid, stereochemistry: normalizeProperties(response.data) };
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

  return normalizeProperties(response.data);
};

const handleGetAssayInfo: ToolHandler = async (args) => {
  const a = args as Record<string, unknown>;
  const api = getClient();
  const response = await api.get(`/assay/aid/${a.aid}/description/JSON`);
  return response.data;
};

const handleGetSafetyData: ToolHandler = async (args) => {
  if (!isValidCidArgs(args)) {
    throw new Error('Invalid CID arguments');
  }

  const api = getClient();
  const response = await api.get(`/compound/cid/${args.cid}/classification/JSON`);
  return response.data;
};

const handleBatchCompoundLookup: ToolHandler = async (args) => {
  if (!isValidBatchArgs(args)) {
    throw new Error('Invalid batch arguments');
  }

  const api = getClient();
  const results = [];

  for (const cid of args.cids) {
    try {
      const response = await api.get(
        `/compound/cid/${cid}/${args.operation && args.operation !== 'property'
          ? args.operation : 'property/MolecularWeight,CanonicalSMILES,IUPACName'}/JSON`,
      );
      results.push({ cid, data: normalizeProperties(response.data), success: true });
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
  get_compound_synonyms: handleGetCompoundSynonyms,
  search_similar_compounds: handleSearchSimilarCompounds,
  get_3d_conformers: handleGet3dConformers,
  analyze_stereochemistry: handleAnalyzeStereochemistry,
  get_compound_properties: handleGetCompoundProperties,
  get_assay_info: handleGetAssayInfo,
  get_safety_data: handleGetSafetyData,
  batch_compound_lookup: handleBatchCompoundLookup,
};
