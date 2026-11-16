import { definitions as definitions0 } from './tools/definitions-target.js';
import { definitions as definitions1 } from './tools/definitions-disease-drug.js';
import { definitions as definitions2 } from './tools/definitions-discovery.js';
import * as targetIdentity from './tools/target/identity.js';
import * as targetBiology from './tools/target/biology.js';
import * as targetAssociations from './tools/target/associations.js';
import * as targetKnownDrugs from './tools/target/known-drugs.js';
import * as targetSafety from './tools/target/safety.js';
import * as disease from './tools/disease.js';
import * as drugIdentity from './tools/drug/identity.js';
import * as drugAssociations from './tools/drug/associations.js';
import * as drugSafety from './tools/drug/safety.js';
import * as evidence from './tools/evidence.js';
import * as search from './tools/search.js';
import * as variant from './tools/variant.js';
import * as study from './tools/study.js';
import * as meta from './tools/meta.js';

export const toolDefinitions = [...definitions0, ...definitions1, ...definitions2];


type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export const toolHandlers: Record<string, ToolHandler> = {
  get_target_info: (args) => targetIdentity.getTargetInfo(args.ensembl_id as string),
  get_target_class: (args) => targetIdentity.getTargetClass(args.ensembl_id as string),
  get_target_alternative_genes: (args) => targetIdentity.getTargetAlternativeGenes(args.ensembl_id as string),

  get_target_expression: (args) => targetBiology.getTargetExpression(args.ensembl_id as string),
  get_target_pathways_and_go_terms: (args) => targetBiology.getTargetPathwaysAndGoTerms(
    args.ensembl_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_target_homologues: (args) => targetBiology.getTargetHomologues(args.ensembl_id as string),
  get_target_subcellular_locations: (args) => targetBiology.getTargetSubcellularLocations(args.ensembl_id as string),
  get_target_genetic_constraint: (args) => targetBiology.getTargetGeneticConstraint(args.ensembl_id as string),
  get_target_mouse_phenotypes: (args) => targetBiology.getTargetMousePhenotypes(
    args.ensembl_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_target_hallmarks: (args) => targetBiology.getTargetHallmarks(args.ensembl_id as string),
  get_target_depmap_essentiality: (args) => targetBiology.getTargetDepmapEssentiality(args.ensembl_id as string),
  get_target_interactions: (args) => targetBiology.getTargetInteractions(
    args.ensembl_id as string,
    args.source_database as string | undefined,
    args.score_threshold as number | undefined,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),

  get_target_associated_diseases: (args) => targetAssociations.getTargetAssociatedDiseases(
    args.ensembl_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_target_known_drugs: (args) => targetKnownDrugs.getTargetKnownDrugs(
    args.ensembl_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_target_literature_occurrences: (args) => targetAssociations.getTargetLiteratureOccurrences(
    args.ensembl_id as string,
    args.additional_entity_ids as string[] | undefined,
    args.start_year as number | undefined,
    args.end_year as number | undefined,
    args.start_month as number | undefined,
    args.end_month as number | undefined,
    args.cursor as string | undefined,
    args.size as number | undefined
  ),

  get_target_safety_information: (args) => targetSafety.getTargetSafetyInformation(args.ensembl_id as string),
  get_target_tractability: (args) => targetSafety.getTargetTractability(args.ensembl_id as string),
  get_target_chemical_probes: (args) => targetSafety.getTargetChemicalProbes(args.ensembl_id as string),
  get_target_prioritization: (args) => targetSafety.getTargetPrioritization(args.ensembl_id as string),

  get_disease_info: (args) => disease.getDiseaseInfo(args.efo_id as string),
  get_disease_associated_targets: (args) => disease.getDiseaseAssociatedTargets(
    args.efo_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_disease_phenotypes: (args) => disease.getDiseasePhenotypes(
    args.efo_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_disease_otar_projects: (args) => disease.getDiseaseOtarProjects(args.efo_id as string),

  get_drug_info: (args) => drugIdentity.getDrugInfo(args.chembl_id as string),
  get_drug_cross_references: (args) => drugIdentity.getDrugCrossReferences(args.chembl_id as string),

  get_drug_linked_diseases: (args) => drugAssociations.getDrugLinkedDiseases(args.chembl_id as string),
  get_drug_linked_targets: (args) => drugAssociations.getDrugLinkedTargets(args.chembl_id as string),

  get_drug_adverse_events: (args) => drugSafety.getDrugAdverseEvents(
    args.chembl_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_drug_pharmacovigilance: (args) => drugSafety.getDrugPharmacovigilance(args.chembl_id as string),
  get_drug_warnings: (args) => drugSafety.getDrugWarnings(args.chembl_id as string),

  get_target_disease_evidence: (args) => evidence.getTargetDiseaseEvidence(
    args.ensembl_id as string,
    args.efo_id as string,
    args.datasource_ids as string[] | undefined,
    args.size as number | undefined,
    args.cursor as string | undefined
  ),
  get_target_disease_biomarkers: (args) => evidence.getTargetDiseaseBiomarkers(
    args.ensembl_id as string,
    args.efo_id as string,
    args.size as number | undefined,
    args.cursor as string | undefined
  ),

  search_entities: (args) => search.searchEntities(
    args.query_string as string,
    args.entity_names as string[] | undefined,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  search_suggestions: (args) => search.searchSuggestions(
    args.query_prefix as string,
    args.entity_names as string[] | undefined,
    args.max_suggestions as number | undefined
  ),
  get_similar_targets: (args) => search.getSimilarTargets(
    args.entity_id as string,
    args.threshold as number | undefined,
    args.size as number | undefined
  ),
  search_facets: (args) => search.searchFacets(
    args.query_string as string | undefined,
    args.category_id as string | undefined,
    args.entity_names as string[] | undefined,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),

  get_variant_info: (args) => variant.getVariantInfo(args.variant_id as string),
  get_variant_credible_sets: (args) => variant.getVariantCredibleSets(
    args.variant_id as string,
    args.study_types as string[] | undefined,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_variant_pharmacogenomics: (args) => variant.getVariantPharmacogenomics(
    args.variant_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_variant_evidences: (args) => variant.getVariantEvidences(
    args.variant_id as string,
    args.datasource_ids as string[] | undefined,
    args.size as number | undefined,
    args.cursor as string | undefined
  ),
  get_variant_intervals: (args) => variant.getVariantIntervals(
    args.variant_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_variant_protein_coordinates: (args) => variant.getVariantProteinCoordinates(
    args.variant_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),

  get_study_info: (args) => study.getStudyInfo(args.study_id as string),
  get_studies_by_disease: (args) => study.getStudiesByDisease(
    args.disease_ids as string[],
    args.enable_indirect as boolean | undefined,
    args.study_id as string | undefined,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_study_credible_sets: (args) => study.getStudyCredibleSets(
    args.study_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_credible_set_by_id: (args) => study.getCredibleSetById(args.study_locus_id as string),
  get_credible_set_colocalisation: (args) => study.getCredibleSetColocalisation(
    args.study_locus_id as string,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),
  get_credible_sets: (args) => study.getCredibleSets(
    args.study_locus_ids as string[] | undefined,
    args.study_ids as string[] | undefined,
    args.variant_ids as string[] | undefined,
    args.study_types as string[] | undefined,
    args.regions as string[] | undefined,
    args.page_index as number | undefined,
    args.page_size as number | undefined
  ),

  get_api_metadata: () => meta.getApiMetadata(),
  get_association_datasources: () => meta.getAssociationDatasources(),
  get_interaction_resources: () => meta.getInteractionResources(),
  get_gene_ontology_terms: (args) => meta.getGeneOntologyTerms(args.go_ids as string[]),
  map_ids: (args) => meta.mapIds(
    args.query_terms as string[],
    args.entity_names as string[] | undefined
  ),
};
