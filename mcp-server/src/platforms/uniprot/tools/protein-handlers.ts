import type { ToolHandler } from '../../../types.js';
import { isRejectedLookup } from '../../../shared/exceptions.js';
import { quoteQuery, reviewedQuery, searchSummaries } from '../search-fields.js';
import { XMLBuilder } from 'fast-xml-parser';
import { ENTRY_FIELDS, EXPORT_FORMATS, fetchProtein, slimProteinInfo, stripEvidences } from '../entry-fields.js';
import { variantSummary } from '../variants.js';
import { batchLookup } from '../batch.js';
import { resolveOrganismFilter } from '../extractors.js';
import type { UniProtEntry } from '../entry-types.js';

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
    ['json', 'xml', 'tsv'].includes(format) ? ENTRY_FIELDS.info : undefined);
  if (format === 'json' || format === 'xml') {
    const slim = slimProteinInfo(data as UniProtEntry);
    return format === 'xml' ? new XMLBuilder({ format: false }).build({ protein: slim }) : slim;
  }
  return String(data);
};

const handleGetProteinSequence: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_sequence');
  const format = optString(args, 'format') ?? 'fasta';
  const data = await fetchProtein(accession, format, format === 'json' ? ENTRY_FIELDS.sequence : undefined);
  if (format !== 'json') return String(data);
  const entry = data as UniProtEntry;
  return { accession: entry.primaryAccession, ...entry.sequence };
};

const handleGetProteinFeatures: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_features');
  const protein = stripEvidences(await fetchProtein(accession, 'json'));
  return {
    accession: protein.primaryAccession,
    name: protein.uniProtkbId,
    features: protein.features || [],
    comments: protein.comments || [],
    keywords: protein.keywords || [],
    domains: protein.features?.filter((f) => f.type === 'Domain') || [],
    activeSites: protein.features?.filter((f) => f.type === 'Active site') || [],
    bindingSites: protein.features?.filter((f) => f.type === 'Binding site') || [],
  };
};

const handleGetProteinStructure: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_structure');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.structure);
  return {
    accession: protein.primaryAccession,
    pdbReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'PDB') || [],
    structuralFeatures:
      protein.features?.filter((f) =>
        ['Turn', 'Helix', 'Beta strand'].includes(f.type),
      ) || [],
    structuralComments: protein.comments?.filter((c) => c.commentType === 'SUBUNIT') || [],
  };
};

const handleGetProteinDomainsDetailed: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_domains_detailed');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.domains);
  return {
    accession: protein.primaryAccession,
    domains: protein.features?.filter((f) => f.type === 'Domain') || [],
    regions: protein.features?.filter((f) => f.type === 'Region') || [],
    repeats: protein.features?.filter((f) => f.type === 'Repeat') || [],
    interproReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'InterPro') || [],
    pfamReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'Pfam') || [],
    smartReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'SMART') || [],
  };
};

const handleGetProteinVariants: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_variants');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.variants);
  return variantSummary(protein);
};

const handleAnalyzeSequenceComposition: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'analyze_sequence_composition');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.composition);
  const sequence = protein.sequence?.value || '';

  const aaCount: Record<string, number> = {};
  const aaFreq: Record<string, number> = {};
  for (const aa of sequence) {
    aaCount[aa] = (aaCount[aa] || 0) + 1;
  }
  for (const [aa, count] of Object.entries(aaCount)) {
    aaFreq[aa] = count / sequence.length;
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
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.pathways);
  return {
    accession: protein.primaryAccession,
    keggReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'KEGG') || [],
    reactomeReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'Reactome') || [],
    pathwayComments: protein.comments?.filter((c) => c.commentType === 'PATHWAY') || [],
    biologicalProcess: protein.comments?.filter((c) => c.commentType === 'FUNCTION') || [],
  };
};

const handleGetProteinInteractions: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_interactions');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.interactions);
  return {
    accession: protein.primaryAccession,
    stringReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'STRING') || [],
    intactReferences: protein.uniProtKBCrossReferences?.filter((ref) => ref.database === 'IntAct') || [],
    interactionComments: protein.comments?.filter((c) => c.commentType === 'INTERACTION') || [],
    subunitComments: protein.comments?.filter((c) => c.commentType === 'SUBUNIT') || [],
  };
};

const handleCompareProteins: ToolHandler = async (args) => {
  const accessions = args.accessions;
  if (
    !Array.isArray(accessions) ||
    accessions.length < 2 ||
    accessions.length > 10 ||
    !accessions.every((a: unknown) => typeof a === 'string' && a.length > 0)
  ) {
    throw new Error('compare_proteins: accessions must be an array of 2-10 non-empty strings');
  }

  const comparisons = [];
  for (const acc of accessions as string[]) {
    const protein = await fetchProtein(acc, 'json', ENTRY_FIELDS.compare);
    const counts = protein.extraAttributes?.countByFeatureType || {};
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
  if (optString(args, 'format') === 'tsv') {
    const columns = ['accession', 'name', 'organism', 'length', 'mass', 'features', 'domains'] as const;
    return [columns.join('\t'), ...comparisons.map(row =>
      columns.map(column => String(row[column] ?? '').replace(/[\t\r\n]/g, ' ')).join('\t'),
    )].join('\n');
  }
  return { comparison: comparisons };
};

// Without a name or gene to match on, the query would degrade to "every reviewed
// protein except this one", so return an explicit empty result instead.
function noMatchKey(accession: string, missing: string) {
  return {
    totalResults: 0, results: [],
    hint: `${accession} has no ${missing} to match on, so no candidates were searched. Try search_proteins or search_by_gene with a known name.`,
  };
}

const handleGetProteinHomologs: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_homologs');
  const organism = optString(args, 'organism');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.homologName);
  const description = protein.proteinDescription;
  const name = description?.recommendedName?.fullName?.value ?? description?.submissionNames?.[0]?.fullName?.value;
  if (!name) return noMatchKey(accession, 'protein name');

  let query = `${reviewedQuery(args)} AND protein_name:${quoteQuery(name)}`;
  if (organism) query += ` AND ${resolveOrganismFilter(organism)}`;
  query += ` NOT accession:${quoteQuery(accession)}`;
  return searchSummaries(query, args.size);
};

const handleGetProteinOrthologs: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_protein_orthologs');
  const organism = optString(args, 'organism');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.orthologGene);
  const gene = protein.genes?.[0]?.geneName?.value;
  if (!gene) return noMatchKey(accession, 'primary gene name');

  let query = `${reviewedQuery(args)} AND gene:${quoteQuery(gene)}`;
  if (organism) query += ` AND ${resolveOrganismFilter(organism)}`;
  query += ` NOT accession:${quoteQuery(accession)}`;
  return searchSummaries(query, args.size);
};

const handleGetPhylogeneticInfo: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_phylogenetic_info');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.taxonomy);
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

const handleBatchProteinLookup: ToolHandler = async (args) =>
  batchLookup(args.accessions, optString(args, 'format') ?? 'json');

const handleGetExternalReferences: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_external_references');
  const protein = await fetchProtein(accession, 'json');
  const refs = protein.uniProtKBCrossReferences || [];
  return {
    accession: protein.primaryAccession,
    referenceCount: refs.length,
    referencesByDatabase: Object.fromEntries([...new Set<string>(refs.map((ref) => ref.database))]
      .map(database => {
        const references = stripEvidences(refs.filter((ref) => ref.database === database));
        return [database, { count: references.length, references }];
      })),
  };
};

const handleGetLiteratureReferences: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_literature_references');
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.literature);
  return {
    accession: protein.primaryAccession,
    references: protein.references || [],
    pubmedReferences: (protein.references || []).flatMap((ref) => ref.citation?.citationCrossReferences || []).filter((ref) => ref.database === 'PubMed'),
    citationCount: protein.references?.length || 0,
  };
};

const handleGetAnnotationConfidence: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'get_annotation_confidence');
  const protein = await fetchProtein(accession, 'json');
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
  if (!EXPORT_FORMATS.includes(format)) {
    throw new Error(`export_protein_data: format must be one of ${EXPORT_FORMATS.join(', ')}`);
  }
  const data = await fetchProtein(accession, format);
  return String(data);
};

const handleValidateAccession: ToolHandler = async (args) => {
  const accession = requireString(args, 'accession', 'validate_accession');
  try {
    const data = await fetchProtein(accession, 'json', ENTRY_FIELDS.validate);
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
  const protein = await fetchProtein(accession, 'json', ENTRY_FIELDS.taxonomy);
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
