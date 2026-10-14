import type { ToolHandler } from '../../../types.js';
import { isRejectedLookup } from '../../../shared/exceptions.js';
import { getClient } from '../client.js';

function requireString(args: Record<string, unknown>, key: string, label: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Invalid ${label}: '${key}' must be a non-empty string`);
  }
  return v;
}

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

function optNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
}

async function fetchProtein(accession: string, format = 'json') {
  const response = await getClient().get(`/uniprotkb/${accession}`, {
    params: { format },
  });
  return response.data;
}

const handleGetProteinInfo: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_info');
  const format = optString(args, 'format') ?? 'json';
  const data = await fetchProtein(accession, format);
  return typeof data === 'object' ? data : String(data);
};

const handleGetProteinSequence: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_sequence');
  const format = optString(args, 'format') ?? 'fasta';
  const data = await fetchProtein(accession, format);
  return typeof data === 'object' ? data : String(data);
};

const handleGetProteinFeatures: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_features');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    name: protein.uniProtkbId,
    features: protein.features || [],
    comments: protein.comments || [],
    keywords: protein.keywords || [],
    domains: protein.features?.filter((f: any) => f.type === 'Domain') || [],
    activeSites: protein.features?.filter((f: any) => f.type === 'Active site') || [],
    bindingSites: protein.features?.filter((f: any) => f.type === 'Binding site') || [],
  };
};

const handleGetProteinStructure: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_structure');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    pdbReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'PDB') || [],
    structuralFeatures:
      protein.features?.filter((f: any) =>
        ['Secondary structure', 'Turn', 'Helix', 'Beta strand'].includes(f.type),
      ) || [],
    structuralComments: protein.comments?.filter((c: any) => c.commentType === 'SUBUNIT') || [],
  };
};

const handleGetProteinDomainsDetailed: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_domains_detailed');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    domains: protein.features?.filter((f: any) => f.type === 'Domain') || [],
    regions: protein.features?.filter((f: any) => f.type === 'Region') || [],
    repeats: protein.features?.filter((f: any) => f.type === 'Repeat') || [],
    interproReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'InterPro') || [],
    pfamReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'Pfam') || [],
    smartReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'SMART') || [],
  };
};

const handleGetProteinVariants: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_variants');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    naturalVariants: protein.features?.filter((f: any) => f.type === 'Natural variant') || [],
    mutagenesisFeatures: protein.features?.filter((f: any) => f.type === 'Mutagenesis') || [],
    diseaseVariants:
      protein.features?.filter((f: any) => f.type === 'Natural variant' && f.association?.disease) || [],
    polymorphisms: protein.comments?.filter((c: any) => c.commentType === 'POLYMORPHISM') || [],
  };
};

const handleAnalyzeSequenceComposition: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'analyze_sequence_composition');
  const protein = await fetchProtein(accession);
  const sequence: string = protein.sequence?.value || '';

  const aaCount: Record<string, number> = {};
  const aaFreq: Record<string, number> = {};
  for (const aa of sequence) {
    aaCount[aa] = (aaCount[aa] || 0) + 1;
  }
  for (const aa in aaCount) {
    aaFreq[aa] = aaCount[aa] / sequence.length;
  }

  return {
    accession: protein.primaryAccession,
    sequenceLength: sequence.length,
    molecularWeight: protein.sequence?.molWeight,
    aminoAcidComposition: aaCount,
    aminoAcidFrequency: aaFreq,
    hydrophobicResidues: ['A', 'I', 'L', 'M', 'F', 'W', 'Y', 'V'].reduce(
      (sum, aa) => sum + (aaCount[aa] || 0),
      0,
    ),
    chargedResidues: ['R', 'H', 'K', 'D', 'E'].reduce((sum, aa) => sum + (aaCount[aa] || 0), 0),
    polarResidues: ['S', 'T', 'N', 'Q'].reduce((sum, aa) => sum + (aaCount[aa] || 0), 0),
  };
};

const handleGetProteinPathways: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_pathways');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    keggReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'KEGG') || [],
    reactomeReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'Reactome') || [],
    pathwayComments: protein.comments?.filter((c: any) => c.commentType === 'PATHWAY') || [],
    biologicalProcess: protein.comments?.filter((c: any) => c.commentType === 'FUNCTION') || [],
  };
};

const handleGetProteinInteractions: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_interactions');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    stringReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'STRING') || [],
    intactReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'IntAct') || [],
    interactionComments: protein.comments?.filter((c: any) => c.commentType === 'INTERACTION') || [],
    subunitComments: protein.comments?.filter((c: any) => c.commentType === 'SUBUNIT') || [],
  };
};

const handleCompareProteins: ToolHandler = async (args) => {
  const accessions = args.accessions;
  if (
    !Array.isArray(accessions) ||
    accessions.length < 2 ||
    accessions.length > 10 ||
    !accessions.every((a: unknown) => typeof a === 'string' && (a as string).length > 0)
  ) {
    throw new Error('compare_proteins: accessions must be an array of 2-10 non-empty strings');
  }

  const comparisons = [];
  for (const acc of accessions as string[]) {
    const protein = await fetchProtein(acc);
    comparisons.push({
      accession: protein.primaryAccession,
      name: protein.uniProtkbId,
      organism: protein.organism?.scientificName,
      length: protein.sequence?.length,
      mass: protein.sequence?.molWeight,
      features: protein.features?.length || 0,
      domains: protein.features?.filter((f: any) => f.type === 'Domain').length || 0,
    });
  }
  return { comparison: comparisons };
};

const handleGetProteinHomologs: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_homologs');
  const organism = optString(args, 'organism');
  const size = optNumber(args, 'size') ?? 25;

  const protein = await fetchProtein(accession);

  let query = 'reviewed:true';
  if (protein.proteinDescription?.recommendedName?.fullName?.value) {
    query += ` AND (${protein.proteinDescription.recommendedName.fullName.value})`;
  }
  if (organism) query += ` AND organism_name:"${organism}"`;
  query += ` NOT accession:"${accession}"`;

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format: 'json', size },
  });
  return response.data;
};

const handleGetProteinOrthologs: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_orthologs');
  const organism = optString(args, 'organism');
  const size = optNumber(args, 'size') ?? 25;

  const protein = await fetchProtein(accession);

  let query = 'reviewed:true';
  if (protein.genes?.[0]?.geneName?.value) {
    query += ` AND gene:"${protein.genes[0].geneName.value}"`;
  }
  if (organism) query += ` AND organism_name:"${organism}"`;
  query += ` NOT accession:"${accession}"`;

  const response = await getClient().get('/uniprotkb/search', {
    params: { query, format: 'json', size },
  });
  return response.data;
};

const handleGetPhylogeneticInfo: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_phylogenetic_info');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    organism: protein.organism,
    taxonomicLineage: protein.organism?.lineage || [],
    evolutionaryOrigin: protein.comments?.filter((c: any) => c.commentType === 'EVOLUTIONARY ORIGIN') || [],
    phylogeneticRange: protein.comments?.filter((c: any) => c.commentType === 'PHYLOGENETIC RANGE') || [],
  };
};

const handleBatchProteinLookup: ToolHandler = async (args) => {
  const accessions = args.accessions;
  if (
    !Array.isArray(accessions) ||
    accessions.length === 0 ||
    accessions.length > 100 ||
    !accessions.every((a: unknown) => typeof a === 'string' && (a as string).length > 0)
  ) {
    throw new Error('batch_protein_lookup: accessions must be an array of 1-100 non-empty strings');
  }
  const format = optString(args, 'format') ?? 'json';

  const results = [];
  const chunkSize = 10;
  for (let i = 0; i < accessions.length; i += chunkSize) {
    const chunk = (accessions as string[]).slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (acc) => {
        try {
          const data = await fetchProtein(acc, format);
          return { accession: acc, data, success: true };
        } catch (error) {
          return {
            accession: acc,
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false,
          };
        }
      }),
    );
    results.push(...chunkResults);
  }
  return { batchResults: results };
};

const handleGetExternalReferences: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_external_references');
  const protein = await fetchProtein(accession);
  const refs = protein.uniProtKBCrossReferences || [];
  return {
    accession: protein.primaryAccession,
    allReferences: refs,
    pdbReferences: refs.filter((ref: any) => ref.database === 'PDB'),
    emblReferences: refs.filter((ref: any) => ref.database === 'EMBL'),
    refseqReferences: refs.filter((ref: any) => ref.database === 'RefSeq'),
    ensemblReferences: refs.filter((ref: any) => ref.database === 'Ensembl'),
    goReferences: refs.filter((ref: any) => ref.database === 'GO'),
  };
};

const handleGetLiteratureReferences: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_literature_references');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    references: protein.references || [],
    pubmedReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'PubMed') || [],
    citationCount: protein.references?.length || 0,
  };
};

const handleGetAnnotationConfidence: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_annotation_confidence');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    entryType: protein.entryType,
    proteinExistence: protein.proteinExistence,
    annotationScore: protein.annotationScore || 'Not available',
    evidenceCodes: protein.features?.map((f: any) => f.evidences).flat().filter(Boolean) || [],
    reviewStatus: protein.entryType === 'UniProtKB reviewed (Swiss-Prot)' ? 'Reviewed' : 'Unreviewed',
    referenceCount: protein.references?.length || 0,
  };
};

const handleExportProteinData: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'export_protein_data');
  const format = requireString(args, 'format', 'export_protein_data');
  const data = await fetchProtein(accession, format);
  return String(data);
};

const handleValidateAccession: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'validate_accession');
  try {
    const data = await fetchProtein(accession);
    return {
      accession,
      isValid: true,
      entryType: data.entryType,
      primaryAccession: data.primaryAccession,
      exists: true,
    };
  } catch (error) {
    if (!isRejectedLookup(error, [400])) throw error;
    return {
      accession,
      isValid: false,
      exists: false,
    };
  }
};

const handleGetTaxonomyInfo: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_taxonomy_info');
  const protein = await fetchProtein(accession);
  return {
    accession: protein.primaryAccession,
    organism: protein.organism,
    taxonomyId: protein.organism?.taxonId,
    scientificName: protein.organism?.scientificName,
    commonName: protein.organism?.commonName,
    lineage: protein.organism?.lineage || [],
    taxonomicDivision: protein.organism?.lineage?.[0] || 'Unknown',
  };
};

export const proteinHandlers: Record<string, ToolHandler> = {
  get_protein_info: handleGetProteinInfo,
  get_protein_sequence: handleGetProteinSequence,
  get_protein_features: handleGetProteinFeatures,
  get_protein_structure: handleGetProteinStructure,
  get_protein_domains_detailed: handleGetProteinDomainsDetailed,
  get_protein_variants: handleGetProteinVariants,
  analyze_sequence_composition: handleAnalyzeSequenceComposition,
  get_protein_pathways: handleGetProteinPathways,
  get_protein_interactions: handleGetProteinInteractions,
  compare_proteins: handleCompareProteins,
  get_protein_homologs: handleGetProteinHomologs,
  get_protein_orthologs: handleGetProteinOrthologs,
  get_phylogenetic_info: handleGetPhylogeneticInfo,
  batch_protein_lookup: handleBatchProteinLookup,
  get_external_references: handleGetExternalReferences,
  get_literature_references: handleGetLiteratureReferences,
  get_annotation_confidence: handleGetAnnotationConfidence,
  export_protein_data: handleExportProteinData,
  validate_accession: handleValidateAccession,
  get_taxonomy_info: handleGetTaxonomyInfo,
};
