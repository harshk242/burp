import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ── Chemical Search & Retrieval (6 tools) ────────────────────────────────────
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

const searchByInchi: Tool = {
  name: 'search_by_inchi',
  description: 'Search for compounds by InChI or InChI key',
  inputSchema: {
    type: 'object',
    properties: {
      inchi: { type: 'string', description: 'InChI string or InChI key' },
    },
    required: ['inchi'],
  },
};
const searchByCasNumber: Tool = {
  name: 'search_by_cas_number',
  description: 'Search for compounds by CAS Registry Number',
  inputSchema: {
    type: 'object',
    properties: {
      cas_number: { type: 'string', description: 'CAS Registry Number (e.g., 50-78-2)' },
    },
    required: ['cas_number'],
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

// ── Structure Analysis & Similarity (5 tools) ───────────────────────────────
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

const substructureSearch: Tool = {
  name: 'substructure_search',
  description: 'Find compounds containing a specific substructure',
  inputSchema: {
    type: 'object',
    properties: {
      smiles: { type: 'string', description: 'SMILES string of the substructure query' },
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

const superstructureSearch: Tool = {
  name: 'superstructure_search',
  description: 'Find larger compounds that contain the query structure',
  inputSchema: {
    type: 'object',
    properties: {
      smiles: { type: 'string', description: 'SMILES string of the query structure' },
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
  description: 'Get 3D conformer data and structural information',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      conformer_type: {
        type: 'string',
        enum: ['3d', '2d'],
        description: 'Type of conformer data (default: 3d)',
      },
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

// ── Chemical Properties & Descriptors (6 tools) ─────────────────────────────
const getCompoundProperties: Tool = {
  name: 'get_compound_properties',
  description: 'Get molecular properties (MW, logP, TPSA, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      properties: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific properties to retrieve (optional)',
      },
    },
    required: ['cid'],
  },
};

const calculateDescriptors: Tool = {
  name: 'calculate_descriptors',
  description: 'Calculate comprehensive molecular descriptors and fingerprints',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      descriptor_type: {
        type: 'string',
        enum: ['all', 'basic', 'topological', '3d'],
        description: 'Type of descriptors (default: all)',
      },
    },
    required: ['cid'],
  },
};

const predictAdmetProperties: Tool = {
  name: 'predict_admet_properties',
  description:
    'Predict ADMET properties (Absorption, Distribution, Metabolism, Excretion, Toxicity)',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      smiles: { type: 'string', description: 'SMILES string (alternative to CID)' },
    },
    required: [],
  },
};

const assessDrugLikeness: Tool = {
  name: 'assess_drug_likeness',
  description:
    'Assess drug-likeness using Lipinski Rule of Five, Veber rules, and PAINS filters',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      smiles: { type: 'string', description: 'SMILES string (alternative to CID)' },
    },
    required: [],
  },
};
const analyzeMolecularComplexity: Tool = {
  name: 'analyze_molecular_complexity',
  description: 'Analyze molecular complexity and synthetic accessibility',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};
const getPharmacophoreFeatures: Tool = {
  name: 'get_pharmacophore_features',
  description: 'Get pharmacophore features and binding site information',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};

// ── Bioassay & Activity Data (5 tools) ───────────────────────────────────────
const searchBioassays: Tool = {
  name: 'search_bioassays',
  description: 'Search for biological assays by target, description, or source',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'General search query' },
      target: { type: 'string', description: 'Target protein or gene name' },
      source: { type: 'string', description: 'Data source (e.g., ChEMBL, NCGC)' },
      max_records: {
        type: 'number',
        description: 'Maximum number of results (1-1000, default: 100)',
        minimum: 1,
        maximum: 1000,
      },
    },
    required: [],
  },
};

const getAssayInfo: Tool = {
  name: 'get_assay_info',
  description: 'Get detailed information for a specific bioassay by AID',
  inputSchema: {
    type: 'object',
    properties: {
      aid: { type: 'number', description: 'PubChem Assay ID (AID)' },
    },
    required: ['aid'],
  },
};

const getCompoundBioactivities: Tool = {
  name: 'get_compound_bioactivities',
  description: 'Get all bioassay results and activities for a compound',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      activity_outcome: {
        type: 'string',
        enum: ['active', 'inactive', 'inconclusive', 'all'],
        description: 'Filter by activity outcome (default: all)',
      },
    },
    required: ['cid'],
  },
};

const searchByTarget: Tool = {
  name: 'search_by_target',
  description: 'Find compounds tested against a specific biological target',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target name (gene, protein, or pathway)' },
      activity_type: { type: 'string', description: 'Type of activity (e.g., IC50, EC50, Ki)' },
      max_records: {
        type: 'number',
        description: 'Maximum number of results (1-1000, default: 100)',
        minimum: 1,
        maximum: 1000,
      },
    },
    required: ['target'],
  },
};

const compareActivityProfiles: Tool = {
  name: 'compare_activity_profiles',
  description: 'Compare bioactivity profiles across multiple compounds',
  inputSchema: {
    type: 'object',
    properties: {
      cids: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of PubChem CIDs (2-50)',
        minItems: 2,
        maxItems: 50,
      },
      activity_type: {
        type: 'string',
        description: 'Specific activity type for comparison (optional)',
      },
    },
    required: ['cids'],
  },
};

// ── Safety & Toxicity (4 tools) ──────────────────────────────────────────────
const getSafetyData: Tool = {
  name: 'get_safety_data',
  description: 'Get GHS hazard classifications and safety information',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};
const getToxicityInfo: Tool = {
  name: 'get_toxicity_info',
  description: 'Get toxicity data including LD50, carcinogenicity, and mutagenicity',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};
const assessEnvironmentalFate: Tool = {
  name: 'assess_environmental_fate',
  description: 'Assess environmental fate including biodegradation and bioaccumulation',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};
const getRegulatoryInfo: Tool = {
  name: 'get_regulatory_info',
  description: 'Get regulatory information from FDA, EPA, and international agencies',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};

// ── Cross-References & Integration (4 tools) ────────────────────────────────
const getExternalReferences: Tool = {
  name: 'get_external_references',
  description: 'Get links to external databases (ChEMBL, DrugBank, KEGG, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
    },
    required: ['cid'],
  },
};
const searchPatents: Tool = {
  name: 'search_patents',
  description: 'Search for chemical patents and intellectual property information',
  inputSchema: {
    type: 'object',
    properties: {
      cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
      query: { type: 'string', description: 'Patent search query (alternative to CID)' },
    },
    required: [],
  },
};
const getLiteratureReferences: Tool = {
  name: 'get_literature_references',
  description: 'Get PubMed citations and scientific literature references',
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

// ── Aggregated export ────────────────────────────────────────────────────────
export const tools: Tool[] = [
  // Chemical Search & Retrieval
  searchCompounds,
  getCompoundInfo,
  searchBySmiles,
  searchByInchi,
  searchByCasNumber,
  getCompoundSynonyms,
  // Structure Analysis & Similarity
  searchSimilarCompounds,
  substructureSearch,
  superstructureSearch,
  get3dConformers,
  analyzeStereochemistry,
  // Chemical Properties & Descriptors
  getCompoundProperties,
  calculateDescriptors,
  predictAdmetProperties,
  assessDrugLikeness,
  analyzeMolecularComplexity,
  getPharmacophoreFeatures,
  // Bioassay & Activity Data
  searchBioassays,
  getAssayInfo,
  getCompoundBioactivities,
  searchByTarget,
  compareActivityProfiles,
  // Safety & Toxicity
  getSafetyData,
  getToxicityInfo,
  assessEnvironmentalFate,
  getRegulatoryInfo,
  // Cross-References & Integration
  getExternalReferences,
  searchPatents,
  getLiteratureReferences,
  batchCompoundLookup,
];
