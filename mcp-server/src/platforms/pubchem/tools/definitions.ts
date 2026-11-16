import { PROPERTY_NAMES } from '../properties.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const searchCompounds: Tool = {
  name: 'search_compounds',
  description: 'Search PubChem database for compounds by name, CAS number, formula, or identifier',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (compound name, CAS, formula, or identifier)' },
      search_type: {
        type: 'string',
        enum: ['name', 'smiles', 'inchi', 'sdf', 'cid', 'formula'],
        description: 'Type of search to perform (default: name)',
      },
      max_records: {
        type: 'number',
        description: 'Maximum number of results (1-10000, default: 100)',
        minimum: 1,
        maximum: 10000,
      },
    },
    required: ['query'],
  },
};

const getCompoundInfo: Tool = {
  name: 'get_compound_info',
  description: 'Get detailed information for a specific compound by PubChem CID',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      format: {
        type: 'string',
        enum: ['json', 'sdf', 'xml', 'asnt', 'asnb'],
        description: 'Output format (default: json)',
      },
      include_descriptions: {
        type: 'boolean',
        description: 'Include PubChem compound descriptions (default: false)',
      },
    },
    required: ['cid'],
  },
};

const searchBySmiles: Tool = {
  name: 'search_by_smiles',
  description: 'Search for compounds by SMILES string (exact match)',
  inputSchema: {
    type: 'object',
    properties: {
      smiles: { type: 'string', description: 'SMILES string of the query molecule' },
    },
    required: ['smiles'],
  },
};

const getCompoundSynonyms: Tool = {
  name: 'get_compound_synonyms',
  description: 'Get all names and synonyms for a compound',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};

const searchSimilarCompounds: Tool = {
  name: 'search_similar_compounds',
  description: 'Find chemically similar compounds using Tanimoto similarity',
  inputSchema: {
    type: 'object',
    properties: {
      smiles: { type: 'string', description: 'SMILES string of the query molecule' },
      threshold: {
        type: 'number',
        description: 'Similarity threshold (0-100, default: 90)',
        minimum: 0,
        maximum: 100,
      },
      max_records: {
        type: 'number',
        description: 'Maximum number of results (1-10000, default: 100)',
        minimum: 1,
        maximum: 10000,
      },
    },
    required: ['smiles'],
  },
};

const get3dConformers: Tool = {
  name: 'get_3d_conformers',
  description: 'Get 3D volume and conformer count properties',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};

const analyzeStereochemistry: Tool = {
  name: 'analyze_stereochemistry',
  description: 'Analyze stereochemistry, chirality, and isomer information',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};

const getCompoundProperties: Tool = {
  name: 'get_compound_properties',
  description: 'Get molecular properties (MW, logP, TPSA, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      properties: {
        type: 'array',
        items: { type: 'string', enum: PROPERTY_NAMES },
        description: 'Supported property tags to retrieve (optional)',
        minItems: 1,
      },
    },
    required: ['cid'],
  },
};

const getAssayInfo: Tool = {
  name: 'get_assay_info',
  description: 'Get metadata and descriptions for a specific bioassay by AID',
  inputSchema: {
    type: 'object',
    properties: {
      aid: { type: 'number', description: 'PubChem Assay ID (AID)' },
    },
    required: ['aid'],
  },
};

const getSafetyData: Tool = {
  name: 'get_safety_data',
  description: 'Get compound classification hierarchies from PubChem',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};

const batchCompoundLookup: Tool = {
  name: 'batch_compound_lookup',
  description: 'Process multiple compound IDs efficiently',
  inputSchema: {
    type: 'object',
    properties: {
      cids: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of PubChem CIDs (1-200)',
        minItems: 1,
        maxItems: 200,
      },
      operation: {
        type: 'string',
        enum: ['property', 'synonyms', 'classification', 'description'],
        description: 'Operation to perform (default: property)',
      },
    },
    required: ['cids'],
  },
};

export const tools: Tool[] = [
  searchCompounds,
  getCompoundInfo,
  searchBySmiles,
  getCompoundSynonyms,
  searchSimilarCompounds,
  get3dConformers,
  analyzeStereochemistry,
  getCompoundProperties,
  getAssayInfo,
  getSafetyData,
  batchCompoundLookup,
];
