import axios, { type AxiosInstance } from 'axios';

// ── ChEMBL API interfaces ──────────────────────────────────────────────────

export interface CompoundSearchResult {
  molecule_chembl_id: string;
  pref_name?: string;
  molecule_type: string;
  molecule_structures: {
    canonical_smiles?: string;
    standard_inchi?: string;
    standard_inchi_key?: string;
  };
  molecule_properties: {
    molecular_weight?: number;
    alogp?: number;
    hbd?: number;
    hba?: number;
    psa?: number;
    rtb?: number;
    ro3_pass?: string;
    num_ro5_violations?: number;
  };
}

export interface TargetInfo {
  target_chembl_id: string;
  pref_name: string;
  target_type: string;
  organism: string;
  species_group_flag: boolean;
  target_components?: Array<{
    component_id: number;
    component_type: string;
    accession?: string;
    sequence?: string;
  }>;
}

export interface ActivityData {
  activity_id: number;
  assay_chembl_id: string;
  molecule_chembl_id: string;
  target_chembl_id: string;
  standard_type?: string;
  standard_value?: number;
  standard_units?: string;
  standard_relation?: string;
  activity_comment?: string;
}

export interface AssayInfo {
  assay_chembl_id: string;
  description: string;
  assay_type: string;
  assay_organism?: string;
  assay_strain?: string;
  assay_tissue?: string;
  assay_cell_type?: string;
  assay_subcellular_fraction?: string;
  target_chembl_id?: string;
  confidence_score?: number;
}

// ── Singleton axios client ─────────────────────────────────────────────────

let apiClient: AxiosInstance | null = null;

export function getClient(): AxiosInstance {
  if (!apiClient) {
    throw new Error('ChEMBL API client not initialised. Call init() first.');
  }
  return apiClient;
}

export function init(_env: Record<string, string | undefined>): void {
  apiClient = axios.create({
    baseURL: 'https://www.ebi.ac.uk/chembl/api/data',
    timeout: 30_000,
    headers: {
      'User-Agent': 'ChEMBL-MCP-Server/1.0.0',
      Accept: 'application/json',
    },
  });
}

export function cleanup(): void {
  apiClient = null;
}

// ── Shared validation helpers ──────────────────────────────────────────────

export const isValidChemblIdArgs = (
  args: any,
): args is { chembl_id: string } => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.chembl_id === 'string' &&
    args.chembl_id.length > 0
  );
};

// ── Shared assessment helpers ──────────────────────────────────────────────

export function assessAbsorption(props: any): string {
  const mw = props.full_mwt || props.molecular_weight || 0;
  const hbd = props.hbd || 0;
  const hba = props.hba || 0;
  const psa = props.psa || 0;

  if (mw > 500 || hbd > 5 || hba > 10 || psa > 140) {
    return 'Poor oral absorption predicted';
  } else if (mw < 400 && hbd <= 3 && hba <= 7 && psa < 100) {
    return 'Good oral absorption predicted';
  }
  return 'Moderate oral absorption predicted';
}

export function assessDistribution(props: any): string {
  const logp = props.alogp || 0;
  const psa = props.psa || 0;

  if (logp > 5) {
    return 'High lipophilicity - may accumulate in tissues';
  } else if (logp < 0) {
    return 'Low lipophilicity - limited tissue distribution';
  } else if (psa < 90 && logp > 0 && logp < 3) {
    return 'Good CNS penetration predicted';
  }
  return 'Moderate distribution predicted';
}

export function assessDrugLikenessFromProps(props: any): string {
  const violations = props.num_ro5_violations || 0;
  if (violations === 0) {
    return 'Excellent drug-likeness (Lipinski compliant)';
  } else if (violations === 1) {
    return 'Good drug-likeness (1 Lipinski violation)';
  }
  return `Poor drug-likeness (${violations} Lipinski violations)`;
}

export function assessPermeability(props: any): string {
  const psa = props.psa || 0;
  const logp = props.alogp || 0;

  if (psa < 90 && logp > 0 && logp < 5) {
    return 'Good membrane permeability predicted';
  } else if (psa > 140 || logp < -1) {
    return 'Poor membrane permeability predicted';
  }
  return 'Moderate membrane permeability predicted';
}

export function getDrugLikenessRecommendation(violations: number, veberPass: boolean): string {
  if (violations === 0 && veberPass) {
    return 'Excellent drug-like properties - suitable for oral administration';
  } else if (violations <= 1 && veberPass) {
    return 'Good drug-like properties - likely suitable for development';
  } else if (violations <= 2) {
    return 'Moderate drug-like properties - may require optimization';
  }
  return 'Poor drug-like properties - significant optimization needed';
}

export function getExternalUrl(source: string, id: string): string {
  const urlMap: Record<string, string> = {
    PubChem: `https://pubchem.ncbi.nlm.nih.gov/compound/${id}`,
    DrugBank: `https://www.drugbank.ca/drugs/${id}`,
    PDB: `https://www.rcsb.org/structure/${id}`,
    UniProt: `https://www.uniprot.org/uniprot/${id}`,
    Wikipedia: `https://en.wikipedia.org/wiki/${id}`,
    KEGG: `https://www.genome.jp/entry/${id}`,
    Reactome: `https://reactome.org/content/detail/${id}`,
  };
  return urlMap[source] || 'https://www.ebi.ac.uk/chembl/';
}
