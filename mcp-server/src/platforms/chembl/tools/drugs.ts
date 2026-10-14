import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, isValidChemblIdArgs } from '../client.js';

export const tools: Tool[] = [
  {
    name: 'search_drugs',
    description: 'Search for approved drugs and clinical candidates',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Drug name or search query' },
        development_phase: { type: 'string', description: 'Development phase filter (e.g., Approved, Phase III)' },
        therapeutic_area: { type: 'string', description: 'Therapeutic area filter' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_drug_info',
    description: 'Get drug development status and clinical trial information',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'search_drug_indications',
    description: 'Search for therapeutic indications and disease areas',
    inputSchema: {
      type: 'object',
      properties: {
        indication: { type: 'string', description: 'Disease or indication search term' },
        drug_type: { type: 'string', description: 'Drug type filter (e.g., Small molecule, Antibody)' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['indication'],
    },
  },
  {
    name: 'get_mechanism_of_action',
    description: 'Get mechanism of action and target interaction data',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
      },
      required: ['chembl_id'],
    },
  },
];

async function handleSearchDrugs(args: Record<string, unknown>) {
  if (!args || typeof args.query !== 'string') {
    throw new Error('Invalid drug search arguments');
  }

  const client = getClient();
  const params: Record<string, unknown> = {
    q: args.query,
    limit: (args.limit as number) || 25,
  };

  const response = await client.get('/molecule/search.json', { params });
  const molecules = response.data.molecules || [];
  const drugs = molecules.filter((m: any) => m.max_phase && m.max_phase >= 1);

  return {
    query: args.query,
    total_results: drugs.length,
    drugs,
  };
}

async function handleGetDrugInfo(args: Record<string, unknown>) {
  if (!isValidChemblIdArgs(args)) {
    throw new Error('Invalid drug info arguments');
  }

  const client = getClient();

  const moleculeResponse = await client.get(`/molecule/${args.chembl_id}.json`);
  const molecule = moleculeResponse.data;

  let indications: unknown[] = [];
  try {
    const indicationResponse = await client.get('/drug_indication.json', {
      params: { molecule_chembl_id: args.chembl_id, limit: 50 },
    });
    indications = indicationResponse.data.drug_indications || [];
  } catch {
  }

  return {
    chembl_id: args.chembl_id,
    molecule_info: molecule,
    development_phase: molecule.max_phase,
    indications,
  };
}

async function handleSearchDrugIndications(args: Record<string, unknown>) {
  if (!args || typeof args.indication !== 'string') {
    throw new Error('Invalid drug indications arguments');
  }

  const client = getClient();
  const response = await client.get('/drug_indication.json', {
    params: { q: args.indication, limit: (args.limit as number) || 25 },
  });
  return response.data;
}

async function handleGetMechanismOfAction(args: Record<string, unknown>) {
  if (!isValidChemblIdArgs(args)) {
    throw new Error('Invalid mechanism of action arguments');
  }

  const client = getClient();
  const response = await client.get('/mechanism.json', {
    params: { molecule_chembl_id: args.chembl_id, limit: 50 },
  });
  return response.data;
}

export const handlers: Record<string, ToolHandler> = {
  search_drugs: handleSearchDrugs,
  get_drug_info: handleGetDrugInfo,
  search_drug_indications: handleSearchDrugIndications,
  get_mechanism_of_action: handleGetMechanismOfAction,
};
