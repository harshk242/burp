import type { ToolHandler } from '../../../types.js';
import { isRejectedLookup } from '../../../shared/exceptions.js';
import { SEARCH_FIELDS, summarizeSearch, quoteQuery, reviewedQuery, searchSummaries } from '../search-fields.js';
import { getClient } from '../client.js';
import { XMLBuilder } from 'fast-xml-parser';
import { fetchProtein, stripEvidences, variantSummary, FEATURE_FIELDS, COMMENT_FIELDS, CROSS_REFERENCE_FIELDS, INFO_FIELDS } from '../entry-fields.js';

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

const handleGetProteinInfo: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_info');
  const format = optString(args, 'format') ?? 'json';
  const data = await fetchProtein(accession, format === 'xml' ? 'json' : format,
    ['json', 'xml', 'tsv'].includes(format) ? INFO_FIELDS : undefined);
  if (format === 'json' || format === 'xml') {
    const slim = stripEvidences(data);
    delete slim.references;
    delete slim.sequence?.value;
    slim.detailTools = { literature: 'get_literature_references', sequence: 'get_protein_sequence', features: 'get_protein_features', externalReferences: 'get_external_references' };
    return format === 'xml' ? new XMLBuilder({ format: false }).build({ protein: slim }) : slim;
  }
  return String(data);
};

const handleGetProteinSequence: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_sequence');
  const format = optString(args, 'format') ?? 'fasta';
  const data = await fetchProtein(accession, format, format === 'json' ? 'accession,sequence,mass,length' : undefined);
  return format === 'json' ? { accession: data.primaryAccession, ...data.sequence } : String(data);
};

const handleGetProteinFeatures: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_features');
  const protein = stripEvidences(await fetchProtein(accession, 'json', `accession,id,${FEATURE_FIELDS},${COMMENT_FIELDS},keyword`));
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
  const protein = await fetchProtein(accession, 'json', 'accession,xref_pdb,ft_turn,ft_helix,ft_strand,cc_subunit');
  return {
    accession: protein.primaryAccession,
    pdbReferences: protein.uniProtKBCrossReferences?.filter((ref: any) => ref.database === 'PDB') || [],
    structuralFeatures:
      protein.features?.filter((f: any) =>
        ['Turn', 'Helix', 'Beta strand'].includes(f.type),
      ) || [],
    structuralComments: protein.comments?.filter((c: any) => c.commentType === 'SUBUNIT') || [],
  };
};

const handleGetProteinDomainsDetailed: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_domains_detailed');
  const protein = await fetchProtein(accession, 'json', 'accession,ft_domain,ft_region,ft_repeat,xref_interpro,xref_pfam,xref_smart');
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
  const protein = await fetchProtein(accession, 'json', 'accession,ft_variant,ft_mutagen,cc_disease,cc_polymorphism');
  return variantSummary(protein);
};

const handleAnalyzeSequenceComposition: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'analyze_sequence_composition');
  const protein = await fetchProtein(accession, 'json', 'accession,sequence,mass');
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
  const protein = await fetchProtein(accession, 'json', 'accession,xref_kegg,xref_reactome,cc_pathway,cc_function');
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
  const protein = await fetchProtein(accession, 'json', 'accession,xref_string,xref_intact,cc_interaction,cc_subunit');
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
    const protein = await fetchProtein(acc, 'json', 'accession,id,organism_name,length,mass,feature_count');
    const counts: Record<string, number> = protein.extraAttributes?.countByFeatureType || {};
    comparisons.push({
      accession: protein.primaryAccession,
      name: protein.uniProtkbId,
      organism: protein.organism?.scientificName,
      length: protein.sequence?.length,
      mass: protein.sequence?.molWeight,
      features: Object.values(counts).reduce((sum, count) => sum + count, 0),
      domains: counts.Domain || 0,
    });
  }
  return { comparison: comparisons };
};

const handleGetProteinHomologs: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_homologs');
  const organism = optString(args, 'organism');
  const size = args.size;

  const protein = await fetchProtein(accession, 'json', 'protein_name');

  let query = reviewedQuery(args);
  if (protein.proteinDescription?.recommendedName?.fullName?.value) {
    query += ` AND protein_name:${quoteQuery(protein.proteinDescription.recommendedName.fullName.value)}`;
  }
  if (organism) query += ` AND organism_name:${quoteQuery(organism)}`;
  query += ` NOT accession:${quoteQuery(accession)}`;

  return searchSummaries(query, size);
};

const handleGetProteinOrthologs: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_orthologs');
  const organism = optString(args, 'organism');
  const size = args.size;

  const protein = await fetchProtein(accession, 'json', 'gene_primary');

  let query = reviewedQuery(args);
  if (protein.genes?.[0]?.geneName?.value) {
    query += ` AND gene:${quoteQuery(protein.genes[0].geneName.value)}`;
  }
  if (organism) query += ` AND organism_name:${quoteQuery(organism)}`;
  query += ` NOT accession:${quoteQuery(accession)}`;

  return searchSummaries(query, size);
};

const handleGetPhylogeneticInfo: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_phylogenetic_info');
  const protein = await fetchProtein(accession, 'json', 'accession,organism_name,organism_id,lineage');
  return {
    accession: protein.primaryAccession,
    organism: protein.organism,
    taxonomicLineage: protein.organism?.lineage || [],
    // UniProtKB has neither of these comment types. Preserve the legacy keys;
    // organism.lineage provides the available phylogenetic classification.
    evolutionaryOrigin: [],
    phylogeneticRange: [],
  };
};

const handleBatchProteinLookup: ToolHandler = async (args) => {
  const accessions = args.accessions;
  if (
    !Array.isArray(accessions) ||
    accessions.length === 0 ||
    accessions.length > 25 ||
    !accessions.every((a: unknown) => typeof a === 'string' && (a as string).length > 0)
  ) {
    throw new Error('batch_protein_lookup: accessions must be an array of 1-25 non-empty strings');
  }
  const format = optString(args, 'format') ?? 'json';

  if (!['json', 'tsv', 'fasta'].includes(format)) throw new Error('Unsupported batch format');
  if (format === 'fasta' && accessions.length > 10) throw new Error('FASTA batches are limited to 10 accessions');
  const response = await getClient().get('/uniprotkb/search', {
    params: {
      query: accessions.map(acc => `accession:${quoteQuery(acc)}`).join(' OR '),
      size: 25, format,
      ...(format === 'fasta' ? {} : { fields: format === 'tsv' ? SEARCH_FIELDS.replace(',cc_function', '') : SEARCH_FIELDS }),
    },
  });
  if (format !== 'json') return String(response.data);
  const summaries = summarizeSearch(response.data).results;
  return { batchResults: accessions.map(accession => {
    const data = summaries.find((entry: any) => entry.accession === accession);
    return data ? { accession, data, success: true }
      : { accession, error: 'Accession not found in batch search', success: false };
  }) };
};

const handleGetExternalReferences: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_external_references');
  const protein = await fetchProtein(accession, 'json', `accession,${CROSS_REFERENCE_FIELDS}`);
  const refs = protein.uniProtKBCrossReferences || [];
  return {
    accession: protein.primaryAccession,
    referenceCount: refs.length,
    referencesByDatabase: Object.fromEntries([...new Set<string>(refs.map((ref: any) => ref.database))]
      .map(database => {
        const references = stripEvidences(refs.filter((ref: any) => ref.database === database));
        return [database, { count: references.length, references }];
      })),
  };
};

const handleGetLiteratureReferences: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_literature_references');
  const protein = await fetchProtein(accession, 'json', 'accession,lit_pubmed_id,lit_doi_id');
  return {
    accession: protein.primaryAccession,
    references: protein.references || [],
    pubmedReferences: (protein.references || []).flatMap((ref: any) => ref.citation?.citationCrossReferences || []).filter((ref: any) => ref.database === 'PubMed'),
    citationCount: protein.references?.length || 0,
  };
};

const handleGetAnnotationConfidence: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_annotation_confidence');
  const protein = await fetchProtein(accession, 'json', `accession,reviewed,protein_existence,annotation_score,lit_pubmed_id,${FEATURE_FIELDS}`);
  const evidenceCodes: Record<string, number> = {};
  for (const feature of protein.features || []) {
    for (const evidence of feature.evidences || []) {
      if (evidence.evidenceCode) evidenceCodes[evidence.evidenceCode] = (evidenceCodes[evidence.evidenceCode] || 0) + 1;
    }
  }
  return {
    accession: protein.primaryAccession,
    entryType: protein.entryType,
    proteinExistence: protein.proteinExistence,
    annotationScore: protein.annotationScore || 'Not available',
    evidenceCodes,
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
    const data = await fetchProtein(accession, 'json', 'accession,reviewed');
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
  const protein = await fetchProtein(accession, 'json', 'accession,organism_name,organism_id,lineage');
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
