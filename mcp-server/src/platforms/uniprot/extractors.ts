export const SPECIES_MAP: Record<string, number> = {
  human: 9606,
  'homo sapiens': 9606,
  mouse: 10090,
  'mus musculus': 10090,
  rat: 10116,
  'rattus norvegicus': 10116,
  cow: 9913,
  'bos taurus': 9913,
  dog: 9615,
  'canis lupus familiaris': 9615,
  chimpanzee: 9598,
  'pan troglodytes': 9598,
  rhesus: 9544,
  'macaca mulatta': 9544,
  pig: 9823,
  'sus scrofa': 9823,
  zebrafish: 7955,
  'danio rerio': 7955,
};

const DEFAULT_SPECIES = 'Homo sapiens';

/**
 * Resolve a list of species identifiers (common names, scientific names,
 * or numeric taxon IDs) into UniProt `organism_name` query fragments.
 *
 * Returns the organism query string to append to the UniProt search query.
 */
export function resolveSpeciesFilter(
  species?: string[],
): string | undefined {
  if (!species || species.length === 0) {
    return `organism_name:"${DEFAULT_SPECIES}"`;
  }

  const parts = species.map((s) => {
    const trimmed = s.trim();
    if (/^\d+$/.test(trimmed)) {
      return `organism_id:${trimmed}`;
    }
    const lower = trimmed.toLowerCase();
    if (SPECIES_MAP[lower]) {
      return `organism_id:${SPECIES_MAP[lower]}`;
    }
    return `organism_name:"${trimmed}"`;
  });

  if (parts.length === 1) return parts[0];
  return `(${parts.join(' OR ')})`;
}

const KEEP_XREF_DBS = new Set([
  'HGNC',
  'MIM',
  'Reactome',
  'GO',
  'Ensembl',
  'ChEMBL',
  'ClinPGx',
  'OpenTargets',
  'Orphanet',
  'InterPro',
]);

const KEEP_FEATURE_TYPES = new Set([
  'Domain',
  'Zinc finger',
  'Region',
]);

const KEEP_COMMENT_TYPES = new Set([
  'FUNCTION',
  'DISEASE',
  'SUBCELLULAR LOCATION',
  'SUBUNIT',
  'INTERACTION',
  'PATHWAY',
  'TISSUE SPECIFICITY',
  'CATALYTIC ACTIVITY',
  'PTM',
]);

export function pickBestEntry(
  results: any[],
): any | undefined {
  if (!results || results.length === 0) return undefined;

  const reviewed = results.filter(
    (r: any) =>
      typeof r.entryType === 'string' && r.entryType.includes('reviewed'),
  );
  const pool = reviewed.length > 0 ? reviewed : results;

  return pool.reduce((best: any, curr: any) =>
    (curr.annotationScore ?? 0) > (best.annotationScore ?? 0) ? curr : best,
  );
}

export interface ExtractedEntry {
  accession: string;
  id: string;
  name: string;
  gene: string | null;
  gene_synonyms: string[];
  organism: string;
  taxon_id: number;
  annotation_score: number;
  sequence_length: number;
  mol_weight: number;
  function: string | null;
  subunit: string | null;
  pathway: string | null;
  tissue_specificity: string | null;
  catalytic_activity: string | null;
  ptm: string[];
  diseases: Array<{
    name: string;
    description?: string;
    note?: string;
  }>;
  subcellular_locations: string[];
  interactions: Array<{
    gene: string;
    n_experiments: number;
  }>;
  domains: Array<{
    type: string;
    name: string;
    start: number;
    end: number;
  }>;
  natural_variants: {
    total_count: number;
    pathogenic: Array<{
      position: number;
      description: string;
      change: string | null;
    }>;
  };
  keywords: string[];
  xrefs: {
    hgnc: string | null;
    omim: string[];
    ensembl_gene: string | null;
    chembl: string | null;
    open_targets: string | null;
    clinpgx: string | null;
    reactome_pathways: string[];
    go_terms: string[];
    orphanet: string[];
    interpro: string[];
  };
}

function textFromComment(comment: any): string | null {
  const texts = comment?.texts;
  if (Array.isArray(texts) && texts.length > 0) {
    return texts[0]?.value ?? null;
  }
  return null;
}

function groupComments(comments: any[]): Record<string, any[]> {
  const map: Record<string, any[]> = {};
  for (const c of comments) {
    const ct = c.commentType;
    if (!ct) continue;
    (map[ct] ??= []).push(c);
  }
  return map;
}

function extractXrefProperty(xref: any, key: string): string | null {
  const props = xref?.properties;
  if (!Array.isArray(props)) return null;
  const match = props.find((p: any) => p.key === key);
  return match?.value ?? null;
}

export function extractEntry(entry: any): ExtractedEntry {
  const comments = entry.comments ?? [];
  const features = entry.features ?? [];
  const xrefs = entry.uniProtKBCrossReferences ?? [];
  const grouped = groupComments(comments);

  const geneBlock = entry.genes?.[0];
  const geneName = geneBlock?.geneName?.value ?? null;
  const geneSynonyms: string[] = (geneBlock?.synonyms ?? []).map(
    (s: any) => s.value,
  );

  const proteinName =
    entry.proteinDescription?.recommendedName?.fullName?.value ??
    entry.proteinDescription?.submissionNames?.[0]?.fullName?.value ??
    entry.uniProtkbId ??
    entry.primaryAccession;

  const functionText = textFromComment(grouped['FUNCTION']?.[0]);

  const subunitText = textFromComment(grouped['SUBUNIT']?.[0]);

  const pathwayText = textFromComment(grouped['PATHWAY']?.[0]);

  const tissueText = textFromComment(grouped['TISSUE SPECIFICITY']?.[0]);

  const catalyticComment = grouped['CATALYTIC ACTIVITY']?.[0];
  const catalyticActivity = catalyticComment?.reaction?.name ?? null;

  const ptmTexts: string[] = (grouped['PTM'] ?? [])
    .map((c: any) => textFromComment(c))
    .filter(Boolean) as string[];

  const diseases = (grouped['DISEASE'] ?? []).map((c: any) => ({
    name: c.disease?.diseaseId ?? 'Unknown',
    description: c.disease?.description,
    note: c.note?.texts?.[0]?.value,
  }));

  const locationSet = new Set<string>();
  for (const c of grouped['SUBCELLULAR LOCATION'] ?? []) {
    for (const loc of c.subcellularLocations ?? []) {
      const val = loc?.location?.value;
      if (val) locationSet.add(val);
    }
  }

  const interactions: Array<{ gene: string; n_experiments: number }> = [];
  for (const c of grouped['INTERACTION'] ?? []) {
    for (const i of c.interactions ?? []) {
      const gene = i?.interactantTwo?.geneName;
      if (gene) {
        interactions.push({
          gene,
          n_experiments: i.numberOfExperiments ?? 0,
        });
      }
    }
  }
  interactions.sort((a, b) => b.n_experiments - a.n_experiments);
  const topInteractions = interactions.slice(0, 20);

  const domains = features
    .filter((f: any) => KEEP_FEATURE_TYPES.has(f.type))
    .map((f: any) => ({
      type: f.type,
      name: f.description ?? f.type,
      start: f.location?.start?.value ?? 0,
      end: f.location?.end?.value ?? 0,
    }));

  const allVariants = features.filter(
    (f: any) => f.type === 'Natural variant',
  );
  const pathogenicVariants = allVariants
    .filter((f: any) => {
      const desc = (f.description ?? '').toLowerCase();
      return desc.includes('pathogenic');
    })
    .map((f: any) => {
      const alt = f.alternativeSequence;
      let change: string | null = null;
      if (alt?.originalSequence && alt?.alternativeSequences?.[0]) {
        change = `${alt.originalSequence}->${alt.alternativeSequences[0]}`;
      }
      return {
        position: f.location?.start?.value ?? 0,
        description: f.description ?? '',
        change,
      };
    });

  const keywords = (entry.keywords ?? []).map((k: any) => k.name);

  const filteredXrefs = xrefs.filter((x: any) =>
    KEEP_XREF_DBS.has(x.database),
  );

  const xrefResult = {
    hgnc: filteredXrefs.find((x: any) => x.database === 'HGNC')?.id ?? null,
    omim: filteredXrefs
      .filter((x: any) => x.database === 'MIM')
      .map((x: any) => x.id),
    ensembl_gene:
      extractXrefProperty(
        filteredXrefs.find((x: any) => x.database === 'Ensembl'),
        'GeneId',
      ),
    chembl:
      filteredXrefs.find((x: any) => x.database === 'ChEMBL')?.id ?? null,
    open_targets:
      filteredXrefs.find((x: any) => x.database === 'OpenTargets')?.id ?? null,
    clinpgx:
      filteredXrefs.find((x: any) => x.database === 'ClinPGx')?.id ?? null,
    reactome_pathways: filteredXrefs
      .filter((x: any) => x.database === 'Reactome')
      .map((x: any) => extractXrefProperty(x, 'PathwayName'))
      .filter(Boolean) as string[],
    go_terms: filteredXrefs
      .filter((x: any) => x.database === 'GO')
      .map((x: any) => extractXrefProperty(x, 'GoTerm'))
      .filter(Boolean) as string[],
    orphanet: filteredXrefs
      .filter((x: any) => x.database === 'Orphanet')
      .map((x: any) => extractXrefProperty(x, 'Disease'))
      .filter(Boolean) as string[],
    interpro: filteredXrefs
      .filter((x: any) => x.database === 'InterPro')
      .map((x: any) => extractXrefProperty(x, 'EntryName'))
      .filter(Boolean) as string[],
  };

  return {
    accession: entry.primaryAccession,
    id: entry.uniProtkbId,
    name: proteinName,
    gene: geneName,
    gene_synonyms: geneSynonyms,
    organism: entry.organism?.scientificName ?? 'Unknown',
    taxon_id: entry.organism?.taxonId ?? 0,
    annotation_score: entry.annotationScore ?? 0,
    sequence_length: entry.sequence?.length ?? 0,
    mol_weight: entry.sequence?.molWeight ?? 0,
    function: functionText,
    subunit: subunitText,
    pathway: pathwayText,
    tissue_specificity: tissueText,
    catalytic_activity: catalyticActivity,
    ptm: ptmTexts,
    diseases,
    subcellular_locations: [...locationSet],
    interactions: topInteractions,
    domains,
    natural_variants: {
      total_count: allVariants.length,
      pathogenic: pathogenicVariants,
    },
    keywords,
    xrefs: xrefResult,
  };
}

export interface ExtractionResult {
  gene_query: string;
  species_filter: string[];
  total_results_returned: number;
  entries: ExtractedEntry[];
}

/**
 * Process a full UniProt search_by_gene response.
 *
 * When `species` is provided, entries are grouped per species and the best
 * reviewed entry per species is extracted. Otherwise defaults to human.
 */
export function extractSearchByGeneResponse(
  rawResponse: any,
  geneQuery: string,
  species?: string[],
): ExtractionResult {
  const results: any[] = rawResponse?.results ?? [];

  const wantedTaxons = resolveWantedTaxons(species);

  const filtered = wantedTaxons
    ? results.filter((r: any) => wantedTaxons.has(r.organism?.taxonId))
    : results;

  const byTaxon = new Map<number, any[]>();
  for (const r of filtered) {
    const tid = r.organism?.taxonId ?? 0;
    const arr = byTaxon.get(tid) ?? [];
    arr.push(r);
    byTaxon.set(tid, arr);
  }

  const entries: ExtractedEntry[] = [];
  for (const [, group] of byTaxon) {
    const best = pickBestEntry(group);
    if (best) {
      entries.push(extractEntry(best));
    }
  }

  return {
    gene_query: geneQuery,
    species_filter: species ?? ['human'],
    total_results_returned: results.length,
    entries,
  };
}

function resolveWantedTaxons(species?: string[]): Set<number> | null {
  if (!species || species.length === 0) {
    return new Set([9606]);
  }
  const ids = new Set<number>();
  for (const s of species) {
    const trimmed = s.trim();
    if (/^\d+$/.test(trimmed)) {
      ids.add(parseInt(trimmed, 10));
    } else {
      const tid = SPECIES_MAP[trimmed.toLowerCase()];
      if (tid) {
        ids.add(tid);
      }
    }
  }
  return ids.size > 0 ? ids : null;
}
