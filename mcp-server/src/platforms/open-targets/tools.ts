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
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireString,
  requireStringArray,
} from '../../shared/args.js';

export const toolDefinitions = [...definitions0, ...definitions1, ...definitions2];

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export const toolHandlers: Record<string, ToolHandler> = {
  get_target_info: (args) => targetIdentity.getTargetInfo(requireString(args, 'ensembl_id')),
  get_target_class: (args) => targetIdentity.getTargetClass(requireString(args, 'ensembl_id')),
  get_target_alternative_genes: (args) => targetIdentity.getTargetAlternativeGenes(requireString(args, 'ensembl_id')),

  get_target_expression: (args) => targetBiology.getTargetExpression(requireString(args, 'ensembl_id')),
  get_target_pathways_and_go_terms: (args) => targetBiology.getTargetPathwaysAndGoTerms(
    requireString(args, 'ensembl_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_target_homologues: (args) => targetBiology.getTargetHomologues(requireString(args, 'ensembl_id')),
  get_target_subcellular_locations: (args) => targetBiology.getTargetSubcellularLocations(requireString(args, 'ensembl_id')),
  get_target_genetic_constraint: (args) => targetBiology.getTargetGeneticConstraint(requireString(args, 'ensembl_id')),
  get_target_mouse_phenotypes: (args) => targetBiology.getTargetMousePhenotypes(
    requireString(args, 'ensembl_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_target_hallmarks: (args) => targetBiology.getTargetHallmarks(requireString(args, 'ensembl_id')),
  get_target_depmap_essentiality: (args) => targetBiology.getTargetDepmapEssentiality(requireString(args, 'ensembl_id')),
  get_target_interactions: (args) => targetBiology.getTargetInteractions(
    requireString(args, 'ensembl_id'),
    optionalString(args, 'source_database'),
    optionalNumber(args, 'score_threshold'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),

  get_target_associated_diseases: (args) => targetAssociations.getTargetAssociatedDiseases(
    requireString(args, 'ensembl_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_target_known_drugs: (args) => targetKnownDrugs.getTargetKnownDrugs(
    requireString(args, 'ensembl_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_target_literature_occurrences: (args) => targetAssociations.getTargetLiteratureOccurrences(
    requireString(args, 'ensembl_id'),
    optionalStringArray(args, 'additional_entity_ids'),
    optionalNumber(args, 'start_year'),
    optionalNumber(args, 'end_year'),
    optionalNumber(args, 'start_month'),
    optionalNumber(args, 'end_month'),
    optionalString(args, 'cursor'),
    optionalNumber(args, 'size')
  ),

  get_target_safety_information: (args) => targetSafety.getTargetSafetyInformation(requireString(args, 'ensembl_id')),
  get_target_tractability: (args) => targetSafety.getTargetTractability(requireString(args, 'ensembl_id')),
  get_target_chemical_probes: (args) => targetSafety.getTargetChemicalProbes(requireString(args, 'ensembl_id')),
  get_target_prioritization: (args) => targetSafety.getTargetPrioritization(requireString(args, 'ensembl_id')),

  get_disease_info: (args) => disease.getDiseaseInfo(requireString(args, 'efo_id')),
  get_disease_associated_targets: (args) => disease.getDiseaseAssociatedTargets(
    requireString(args, 'efo_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_disease_phenotypes: (args) => disease.getDiseasePhenotypes(
    requireString(args, 'efo_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_disease_otar_projects: (args) => disease.getDiseaseOtarProjects(requireString(args, 'efo_id')),

  get_drug_info: (args) => drugIdentity.getDrugInfo(requireString(args, 'chembl_id')),
  get_drug_cross_references: (args) => drugIdentity.getDrugCrossReferences(requireString(args, 'chembl_id')),

  get_drug_linked_diseases: (args) => drugAssociations.getDrugLinkedDiseases(requireString(args, 'chembl_id')),
  get_drug_linked_targets: (args) => drugAssociations.getDrugLinkedTargets(requireString(args, 'chembl_id')),

  get_drug_adverse_events: (args) => drugSafety.getDrugAdverseEvents(
    requireString(args, 'chembl_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_drug_pharmacovigilance: (args) => drugSafety.getDrugPharmacovigilance(requireString(args, 'chembl_id')),
  get_drug_warnings: (args) => drugSafety.getDrugWarnings(requireString(args, 'chembl_id')),

  get_target_disease_evidence: (args) => evidence.getTargetDiseaseEvidence(
    requireString(args, 'ensembl_id'),
    requireString(args, 'efo_id'),
    optionalStringArray(args, 'datasource_ids'),
    optionalNumber(args, 'size'),
    optionalString(args, 'cursor')
  ),
  get_target_disease_biomarkers: (args) => evidence.getTargetDiseaseBiomarkers(
    requireString(args, 'ensembl_id'),
    requireString(args, 'efo_id'),
    optionalNumber(args, 'size'),
    optionalString(args, 'cursor')
  ),

  search_entities: (args) => search.searchEntities(
    requireString(args, 'query_string'),
    optionalStringArray(args, 'entity_names'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  search_suggestions: (args) => search.searchSuggestions(
    requireString(args, 'query_prefix'),
    optionalStringArray(args, 'entity_names'),
    optionalNumber(args, 'max_suggestions')
  ),
  get_similar_targets: (args) => search.getSimilarTargets(
    requireString(args, 'entity_id'),
    optionalNumber(args, 'threshold'),
    optionalNumber(args, 'size')
  ),
  search_facets: (args) => search.searchFacets(
    optionalString(args, 'query_string'),
    optionalString(args, 'category_id'),
    optionalStringArray(args, 'entity_names'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),

  get_variant_info: (args) => variant.getVariantInfo(requireString(args, 'variant_id')),
  get_variant_credible_sets: (args) => variant.getVariantCredibleSets(
    requireString(args, 'variant_id'),
    optionalStringArray(args, 'study_types'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_variant_pharmacogenomics: (args) => variant.getVariantPharmacogenomics(
    requireString(args, 'variant_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_variant_evidences: (args) => variant.getVariantEvidences(
    requireString(args, 'variant_id'),
    optionalStringArray(args, 'datasource_ids'),
    optionalNumber(args, 'size'),
    optionalString(args, 'cursor')
  ),
  get_variant_intervals: (args) => variant.getVariantIntervals(
    requireString(args, 'variant_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_variant_protein_coordinates: (args) => variant.getVariantProteinCoordinates(
    requireString(args, 'variant_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),

  get_study_info: (args) => study.getStudyInfo(requireString(args, 'study_id')),
  get_studies_by_disease: (args) => study.getStudiesByDisease(
    requireStringArray(args, 'disease_ids'),
    optionalBoolean(args, 'enable_indirect'),
    optionalString(args, 'study_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_study_credible_sets: (args) => study.getStudyCredibleSets(
    requireString(args, 'study_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_credible_set_by_id: (args) => study.getCredibleSetById(requireString(args, 'study_locus_id')),
  get_credible_set_colocalisation: (args) => study.getCredibleSetColocalisation(
    requireString(args, 'study_locus_id'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),
  get_credible_sets: (args) => study.getCredibleSets(
    optionalStringArray(args, 'study_locus_ids'),
    optionalStringArray(args, 'study_ids'),
    optionalStringArray(args, 'variant_ids'),
    optionalStringArray(args, 'study_types'),
    optionalStringArray(args, 'regions'),
    optionalNumber(args, 'page_index'),
    optionalNumber(args, 'page_size')
  ),

  get_api_metadata: () => meta.getApiMetadata(),
  get_association_datasources: () => meta.getAssociationDatasources(),
  get_interaction_resources: () => meta.getInteractionResources(),
  get_gene_ontology_terms: (args) => meta.getGeneOntologyTerms(requireStringArray(args, 'go_ids')),
  map_ids: (args) => meta.mapIds(
    requireStringArray(args, 'query_terms'),
    optionalStringArray(args, 'entity_names')
  ),
};
