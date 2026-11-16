import { getClient } from './client.js';

// Return fields verified against /configure/uniprotkb/result-fields and live JSON.
// All selectable features/comments are needed by get_protein_features; confidence
// counts evidence across all feature types. WEB RESOURCE comments have no return
// field and are omitted (external database links have their own dedicated tool).
export const FEATURE_FIELDS = [
  'ft_var_seq,ft_variant,ft_non_cons,ft_non_std,ft_non_ter,ft_conflict,ft_unsure,ft_act_site,ft_binding',
  'ft_dna_bind,ft_site,ft_mutagen,ft_intramem,ft_topo_dom,ft_transmem,ft_chain,ft_crosslnk,ft_disulfid,ft_carbohyd',
  'ft_init_met,ft_lipid,ft_mod_res,ft_peptide,ft_propep,ft_signal,ft_transit,ft_strand,ft_helix,ft_turn,ft_coiled',
  'ft_compbias,ft_domain,ft_motif,ft_region,ft_repeat,ft_zn_fing',
].join(',');
export const COMMENT_FIELDS = [
  'cc_alternative_products,cc_sc_epred,cc_mass_spectrometry,cc_polymorphism,cc_rna_editing,cc_sequence_caution',
  'cc_catalytic_activity,cc_cofactor,cc_activity_regulation,cc_function,cc_pathway,cc_caution,cc_miscellaneous',
  'cc_interaction,cc_subunit,cc_developmental_stage,cc_induction,cc_tissue_specificity,cc_allergen',
  'cc_biotechnology,cc_disruption_phenotype,cc_disease,cc_pharmaceutical,cc_toxic_dose,cc_subcellular_location',
  'cc_ptm,cc_domain,cc_similarity,absorption,kinetics,ph_dependence,redox_potential,temp_dependence',
  'protein_families',
].join(',');
export const CROSS_REFERENCE_FIELDS = [
  'xref_proteomes,xref_ccds,xref_embl,xref_generif,xref_pir,xref_refseq,xref_alphafolddb,xref_bmrb,xref_emdb',
  'xref_mdrepo,xref_mdposit,xref_pcddb,xref_pdb,xref_sasbdb,xref_smr,xref_biogrid,xref_corum,xref_complexportal',
  'xref_dip,xref_elm,xref_funcoup,xref_intact,xref_mint,xref_ndex,xref_string,xref_bindingdb,xref_chebi',
  'xref_chembl,xref_drugbank,xref_drugcentral,xref_guidetopharmacology,xref_swisslipids,xref_allergome,xref_card',
  'xref_cazy,xref_esther,xref_imgt_gene-db,xref_merops,xref_moondb,xref_moonprot,xref_peroxibase,xref_rebase',
  'xref_tcdb,xref_unilectin,xref_carbonyldb,xref_depod,xref_glyconnect,xref_glycosmos,xref_glygen,xref_metosite',
  'xref_phosphositeplus,xref_swisspalm,xref_unicarbkb,xref_iptmnet,xref_alzforum,xref_biomuta,xref_dmdm,xref_dbsnp',
  'xref_ogp,xref_reproduction-2dpage,xref_cptac,xref_massive,xref_pride,xref_paxdb,xref_peptideatlas,xref_promex',
  'xref_proteomicsdb,xref_pumba,xref_topdownproteomics,xref_jpost,xref_abcd,xref_antibodypedia,xref_cptc',
  'xref_dnasu,xref_ycharos,xref_ensembl,xref_ensemblbacteria,xref_ensemblfungi,xref_ensemblmetazoa',
  'xref_ensemblplants,xref_ensemblprotists,xref_geneid,xref_gramene,xref_kegg,xref_mane-select,xref_patric',
  'xref_ucsc,xref_vectorbase,xref_wbparasite,xref_agr,xref_arachnoserver,xref_araport,xref_cgd,xref_civic,xref_ctd',
  'xref_clinpgx,xref_conoserver,xref_disgenet,xref_echobase,xref_flybase,xref_genecards,xref_genereviews,xref_hgnc',
  'xref_hpa,xref_ic4r,xref_japonicusdb,xref_leproma,xref_mgi,xref_mim,xref_maizegdb,xref_malacards,xref_niagads',
  'xref_opentargets,xref_orphanet,xref_pombase,xref_pseudocap,xref_rgd,xref_sgd,xref_tair,xref_tuberculist',
  'xref_veupathdb,xref_vgnc,xref_wormbase,xref_xenbase,xref_zfin,xref_dictybase,xref_euhcvdb,xref_genetree',
  'xref_hogenom,xref_inparanoid,xref_oma,xref_orthodb,xref_pan-go,xref_phylomedb,xref_eggnog,xref_brenda',
  'xref_biocyc,xref_pathwaycommons,xref_plantreactome,xref_reactome,xref_sabio-rk,xref_signor,xref_strenda-db',
  'xref_signalink,xref_unipathway,xref_agora,xref_biogrid-orcs,xref_cd-code,xref_chitars,xref_evolutionarytrace',
  'xref_genewiki,xref_genomernai,xref_orcid,xref_pgenn,xref_phi-base,xref_pro,xref_pharos,xref_pubtator,xref_rnact',
  'xref_emind,xref_abasyatlas,xref_bgee,xref_cleanex,xref_collectf,xref_expressionatlas,xref_antifam,xref_cdd',
  'xref_disprot,xref_funfam,xref_gene3d,xref_hamap,xref_ideal,xref_interpro,xref_ncbifam,xref_panther,xref_pirsf',
  'xref_prints,xref_prosite,xref_pfam,xref_sfld,xref_smart,xref_supfam,go',
].join(',');
export const INFO_FIELDS = [
  'accession,id,reviewed,protein_name,gene_names,organism_name,organism_id,lineage,length,mass,annotation_score',
  'protein_existence,keyword,cc_function,cc_catalytic_activity,cc_cofactor,cc_pathway,cc_subunit',
  'cc_subcellular_location,cc_tissue_specificity,cc_disease,cc_similarity,cc_domain,xref_pdb,xref_interpro',
  'xref_pfam',
].join(',');

export function stripEvidences(value: any): any {
  if (Array.isArray(value)) return value.map(stripEvidences);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'evidences')
      .map(([key, child]) => [key, stripEvidences(child)]),
  );
  return value;
}

export async function fetchProtein(accession: string, format = 'json', fields?: string) {
  const response = await getClient().get(`/uniprotkb/${encodeURIComponent(accession)}`, {
    params: { format, ...(fields ? { fields } : {}) },
  });
  return response.data;
}

// A conservative annotation-based subset, not a clinical pathogenicity prediction.
// Match whole DISEASE comment acronyms; sporadic cancers without a named acronym
// remain in naturalVariants. Evidence presence alone does not imply disease linkage.
export function variantSummary(protein: any) {
  const naturalVariants = stripEvidences(protein.features?.filter((f: any) => f.type === 'Natural variant') || []);
  const acronyms: string[] = [...new Set<string>((protein.comments || [])
    .filter((c: any) => c.commentType === 'DISEASE')
    .map((c: any) => c.disease?.acronym).filter(Boolean))];
  const diseaseVariants = naturalVariants.filter((f: any) => acronyms.some(acronym => {
    const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`).test(f.description || '');
  }));
  return {
    accession: protein.primaryAccession,
    naturalVariants,
    mutagenesisFeatures: stripEvidences(protein.features?.filter((f: any) => f.type === 'Mutagenesis') || []),
    diseaseVariants,
    polymorphisms: stripEvidences(protein.comments?.filter((c: any) => c.commentType === 'POLYMORPHISM') || []),
    naturalVariantCount: naturalVariants.length,
    diseaseVariantCount: diseaseVariants.length,
    diseaseVariantCriterion: 'Description contains a whole disease acronym from this entry’s DISEASE comments; not a pathogenicity classification.',
    diseaseAcronyms: acronyms,
  };
}
