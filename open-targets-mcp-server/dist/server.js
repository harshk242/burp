// Open Targets MCP Server
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { initializeClient, closeClient } from './client.js';
// Import all tools
import * as targetIdentity from './tools/target/identity.js';
import * as targetBiology from './tools/target/biology.js';
import * as targetAssociations from './tools/target/associations.js';
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
// Tool definitions with schemas
const toolDefinitions = [
    // Target Identity Tools
    {
        name: 'get_target_info',
        description: 'Retrieve core identity details for a target gene including approved symbol, name, biotype, and chromosomal location.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier (e.g., "ENSG00000157764")' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_class',
        description: 'Return ChEMBL target class annotations for a gene.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_alternative_genes',
        description: 'List alternate gene symbols and database cross-references for a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    // Target Biology Tools
    {
        name: 'get_target_expression',
        description: 'Return RNA and protein expression profiles for a target across tissues.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_pathways_and_go_terms',
        description: 'List pathway memberships and Gene Ontology annotations for a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_homologues',
        description: 'Retrieve cross-species homologues for a target gene.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_subcellular_locations',
        description: 'Return subcellular localisation annotations for a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_genetic_constraint',
        description: 'Fetch genetic constraint metrics (gnomAD) for a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_mouse_phenotypes',
        description: 'Retrieve mouse knockout phenotypes associated with a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_hallmarks',
        description: 'Return cancer hallmark annotations associated with a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_depmap_essentiality',
        description: 'Fetch DepMap CRISPR essentiality scores across cell lines.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_interactions',
        description: 'Retrieve protein interaction partners for a target from curated databases.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                source_database: { type: 'string', description: 'Limit to specific interaction datasource' },
                score_threshold: { type: 'number', description: 'Minimum confidence score (0-1)' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['ensembl_id'],
        },
    },
    // Target Associations Tools
    {
        name: 'get_target_associated_diseases',
        description: 'List diseases linked to a target with association scores.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_known_drugs',
        description: 'Return compounds with known activity on the target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_literature_occurrences',
        description: 'Return literature co-occurrence records for a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                additional_entity_ids: { type: 'array', items: { type: 'string' }, description: 'Additional entity IDs to co-filter on' },
                start_year: { type: 'number', description: 'Start year filter' },
                end_year: { type: 'number', description: 'End year filter' },
                start_month: { type: 'number', description: 'Start month filter' },
                end_month: { type: 'number', description: 'End month filter' },
                cursor: { type: 'string', description: 'Pagination cursor' },
                size: { type: 'number', description: 'Number of rows to return (default 20)' },
            },
            required: ['ensembl_id'],
        },
    },
    // Target Safety Tools
    {
        name: 'get_target_safety_information',
        description: 'Retrieve documented safety liabilities for a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_tractability',
        description: 'Return tractability assessments across modalities for a target.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_chemical_probes',
        description: 'List available chemical probes and their quality metrics.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_tep',
        description: 'Fetch Target Enabling Package (TEP) information for a gene.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    {
        name: 'get_target_prioritization',
        description: 'Return target prioritisation scores compiled across data sources.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
            },
            required: ['ensembl_id'],
        },
    },
    // Disease Tools
    {
        name: 'get_disease_info',
        description: 'Retrieve core metadata for an Open Targets disease entity. Accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.). Use search_entities to find disease IDs.',
        inputSchema: {
            type: 'object',
            properties: {
                efo_id: { type: 'string', description: 'Disease identifier from any ontology (e.g., "MONDO_0004975" for Alzheimer\'s, "EFO_0003884" for asthma). Use search_entities with entity_names=["disease"] to find IDs.' },
            },
            required: ['efo_id'],
        },
    },
    {
        name: 'get_disease_associated_targets',
        description: 'List targets associated with a disease, including evidence scores. Accepts disease IDs from any ontology.',
        inputSchema: {
            type: 'object',
            properties: {
                efo_id: { type: 'string', description: 'Disease identifier from any ontology (EFO, MONDO, Orphanet, etc.)' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['efo_id'],
        },
    },
    {
        name: 'get_disease_phenotypes',
        description: 'Fetch HPO phenotype annotations linked to a disease. Accepts disease IDs from any ontology.',
        inputSchema: {
            type: 'object',
            properties: {
                efo_id: { type: 'string', description: 'Disease identifier from any ontology (EFO, MONDO, Orphanet, etc.)' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['efo_id'],
        },
    },
    {
        name: 'get_disease_otar_projects',
        description: 'List Open Targets Associated Research (OTAR) projects linked to a disease. Accepts disease IDs from any ontology.',
        inputSchema: {
            type: 'object',
            properties: {
                efo_id: { type: 'string', description: 'Disease identifier from any ontology (EFO, MONDO, Orphanet, etc.)' },
            },
            required: ['efo_id'],
        },
    },
    // Drug Tools
    {
        name: 'get_drug_info',
        description: 'Fetch identity, indication, and mechanism data for a drug.',
        inputSchema: {
            type: 'object',
            properties: {
                chembl_id: { type: 'string', description: 'Drug identifier (e.g., "CHEMBL1862")' },
            },
            required: ['chembl_id'],
        },
    },
    {
        name: 'get_drug_cross_references',
        description: 'Retrieve cross-database identifiers related to a drug.',
        inputSchema: {
            type: 'object',
            properties: {
                chembl_id: { type: 'string', description: 'Drug identifier' },
            },
            required: ['chembl_id'],
        },
    },
    {
        name: 'get_drug_linked_diseases',
        description: 'List diseases connected to a drug across indications and mechanisms.',
        inputSchema: {
            type: 'object',
            properties: {
                chembl_id: { type: 'string', description: 'Drug identifier' },
            },
            required: ['chembl_id'],
        },
    },
    {
        name: 'get_drug_linked_targets',
        description: 'Return targets linked to a drug via mechanism-of-action data.',
        inputSchema: {
            type: 'object',
            properties: {
                chembl_id: { type: 'string', description: 'Drug identifier' },
            },
            required: ['chembl_id'],
        },
    },
    {
        name: 'get_drug_adverse_events',
        description: 'Retrieve adverse event signals associated with a drug.',
        inputSchema: {
            type: 'object',
            properties: {
                chembl_id: { type: 'string', description: 'Drug identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['chembl_id'],
        },
    },
    {
        name: 'get_drug_pharmacovigilance',
        description: 'Summarise high-level pharmacovigilance data for a drug.',
        inputSchema: {
            type: 'object',
            properties: {
                chembl_id: { type: 'string', description: 'Drug identifier' },
            },
            required: ['chembl_id'],
        },
    },
    {
        name: 'get_drug_warnings',
        description: 'Fetch detailed regulatory warnings, including withdrawals and boxed labels.',
        inputSchema: {
            type: 'object',
            properties: {
                chembl_id: { type: 'string', description: 'Drug identifier' },
            },
            required: ['chembl_id'],
        },
    },
    // Evidence Tools
    {
        name: 'get_target_disease_evidence',
        description: 'Retrieve evidence strings linking a target to a disease.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                efo_id: { type: 'string', description: 'Disease identifier' },
                datasource_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by datasource IDs' },
                size: { type: 'number', description: 'Number of rows (default 10)' },
                cursor: { type: 'string', description: 'Pagination cursor' },
            },
            required: ['ensembl_id', 'efo_id'],
        },
    },
    {
        name: 'get_target_disease_biomarkers',
        description: 'Inspect evidence for biomarker annotations linking a target and disease.',
        inputSchema: {
            type: 'object',
            properties: {
                ensembl_id: { type: 'string', description: 'Target identifier' },
                efo_id: { type: 'string', description: 'Disease identifier' },
                size: { type: 'number', description: 'Number of rows (default 10)' },
                cursor: { type: 'string', description: 'Pagination cursor' },
            },
            required: ['ensembl_id', 'efo_id'],
        },
    },
    // Search Tools
    {
        name: 'search_entities',
        description: 'Search Open Targets entities and resolve synonyms to canonical IDs.',
        inputSchema: {
            type: 'object',
            properties: {
                query_string: { type: 'string', description: 'Search query (e.g., "BRAF", "melanoma")' },
                entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types to search' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['query_string'],
        },
    },
    {
        name: 'search_suggestions',
        description: 'Return autocomplete suggestions for partially typed queries.',
        inputSchema: {
            type: 'object',
            properties: {
                query_prefix: { type: 'string', description: 'Partial search term (min 3 chars)' },
                entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types to search' },
                max_suggestions: { type: 'number', description: 'Maximum suggestions (default 10)' },
            },
            required: ['query_prefix'],
        },
    },
    {
        name: 'get_similar_targets',
        description: 'Identify targets with similar association profiles to the seed target.',
        inputSchema: {
            type: 'object',
            properties: {
                entity_id: { type: 'string', description: 'Ensembl gene identifier' },
                threshold: { type: 'number', description: 'Minimum similarity score (default 0.5)' },
                size: { type: 'number', description: 'Maximum results (default 10)' },
            },
            required: ['entity_id'],
        },
    },
    {
        name: 'search_facets',
        description: 'Return facet counts to help filter search results.',
        inputSchema: {
            type: 'object',
            properties: {
                query_string: { type: 'string', description: 'Search query' },
                category_id: { type: 'string', description: 'Restrict to category' },
                entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 20)' },
            },
            required: [],
        },
    },
    // Variant Tools
    {
        name: 'get_variant_info',
        description: 'Retrieve core metadata and functional annotations for a variant.',
        inputSchema: {
            type: 'object',
            properties: {
                variant_id: { type: 'string', description: 'Variant identifier (e.g., "7_140453136_A_T")' },
            },
            required: ['variant_id'],
        },
    },
    {
        name: 'get_variant_credible_sets',
        description: 'List credible sets that include a specific variant.',
        inputSchema: {
            type: 'object',
            properties: {
                variant_id: { type: 'string', description: 'Variant identifier' },
                study_types: { type: 'array', items: { type: 'string' }, description: 'Filter by study types' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['variant_id'],
        },
    },
    {
        name: 'get_variant_pharmacogenomics',
        description: 'Retrieve pharmacogenomic annotations for a variant.',
        inputSchema: {
            type: 'object',
            properties: {
                variant_id: { type: 'string', description: 'Variant identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['variant_id'],
        },
    },
    {
        name: 'get_variant_evidences',
        description: 'Retrieve evidence strings linking a variant to targets or diseases.',
        inputSchema: {
            type: 'object',
            properties: {
                variant_id: { type: 'string', description: 'Variant identifier' },
                datasource_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by datasources' },
                size: { type: 'number', description: 'Number of rows (default 10)' },
                cursor: { type: 'string', description: 'Pagination cursor' },
            },
            required: ['variant_id'],
        },
    },
    {
        name: 'get_variant_intervals',
        description: 'Retrieve enhancer-to-gene (E2G) predictions overlapping a variant.',
        inputSchema: {
            type: 'object',
            properties: {
                variant_id: { type: 'string', description: 'Variant identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['variant_id'],
        },
    },
    {
        name: 'get_variant_protein_coordinates',
        description: 'Retrieve protein-level consequences for a variant.',
        inputSchema: {
            type: 'object',
            properties: {
                variant_id: { type: 'string', description: 'Variant identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['variant_id'],
        },
    },
    // Study Tools
    {
        name: 'get_study_info',
        description: 'Retrieve metadata and cohort details for a GWAS study.',
        inputSchema: {
            type: 'object',
            properties: {
                study_id: { type: 'string', description: 'Study identifier (e.g., "GCST90002357")' },
            },
            required: ['study_id'],
        },
    },
    {
        name: 'get_studies_by_disease',
        description: 'List studies linked to one or more diseases.',
        inputSchema: {
            type: 'object',
            properties: {
                disease_ids: { type: 'array', items: { type: 'string' }, description: 'Disease identifiers' },
                enable_indirect: { type: 'boolean', description: 'Include indirect associations (default false)' },
                study_id: { type: 'string', description: 'Filter to specific study' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['disease_ids'],
        },
    },
    {
        name: 'get_study_credible_sets',
        description: 'Retrieve fine-mapped credible sets for a study.',
        inputSchema: {
            type: 'object',
            properties: {
                study_id: { type: 'string', description: 'Study identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['study_id'],
        },
    },
    {
        name: 'get_credible_set_by_id',
        description: 'Fetch detailed information for a specific study locus credible set.',
        inputSchema: {
            type: 'object',
            properties: {
                study_locus_id: { type: 'string', description: 'Credible set identifier' },
            },
            required: ['study_locus_id'],
        },
    },
    {
        name: 'get_credible_set_colocalisation',
        description: 'Retrieve colocalisation results for a credible set.',
        inputSchema: {
            type: 'object',
            properties: {
                study_locus_id: { type: 'string', description: 'Credible set identifier' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: ['study_locus_id'],
        },
    },
    {
        name: 'get_credible_sets',
        description: 'Query credible sets with flexible filtering options.',
        inputSchema: {
            type: 'object',
            properties: {
                study_locus_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by credible set IDs' },
                study_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by study IDs' },
                variant_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by variant IDs' },
                study_types: { type: 'array', items: { type: 'string' }, description: 'Filter by study types' },
                regions: { type: 'array', items: { type: 'string' }, description: 'Filter by genomic regions' },
                page_index: { type: 'number', description: 'Page index (default 0)' },
                page_size: { type: 'number', description: 'Page size (default 10)' },
            },
            required: [],
        },
    },
    // Meta Tools
    {
        name: 'get_api_metadata',
        description: 'Return Open Targets Platform release metadata.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_association_datasources',
        description: 'List sources contributing target-disease association evidence.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_interaction_resources',
        description: 'Enumerate interaction databases integrated into Open Targets.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_gene_ontology_terms',
        description: 'Resolve Gene Ontology identifiers to human-readable labels.',
        inputSchema: {
            type: 'object',
            properties: {
                go_ids: { type: 'array', items: { type: 'string' }, description: 'GO identifiers (e.g., ["GO:0006915"])' },
            },
            required: ['go_ids'],
        },
    },
    {
        name: 'map_ids',
        description: 'Map free-text terms to canonical Open Targets identifiers.',
        inputSchema: {
            type: 'object',
            properties: {
                query_terms: { type: 'array', items: { type: 'string' }, description: 'Free-text terms to map' },
                entity_names: { type: 'array', items: { type: 'string' }, description: 'Entity types to consider' },
            },
            required: ['query_terms'],
        },
    },
];
const toolHandlers = {
    // Target Identity
    get_target_info: (args) => targetIdentity.getTargetInfo(args.ensembl_id),
    get_target_class: (args) => targetIdentity.getTargetClass(args.ensembl_id),
    get_target_alternative_genes: (args) => targetIdentity.getTargetAlternativeGenes(args.ensembl_id),
    // Target Biology
    get_target_expression: (args) => targetBiology.getTargetExpression(args.ensembl_id),
    get_target_pathways_and_go_terms: (args) => targetBiology.getTargetPathwaysAndGoTerms(args.ensembl_id, args.page_index, args.page_size),
    get_target_homologues: (args) => targetBiology.getTargetHomologues(args.ensembl_id),
    get_target_subcellular_locations: (args) => targetBiology.getTargetSubcellularLocations(args.ensembl_id),
    get_target_genetic_constraint: (args) => targetBiology.getTargetGeneticConstraint(args.ensembl_id),
    get_target_mouse_phenotypes: (args) => targetBiology.getTargetMousePhenotypes(args.ensembl_id, args.page_index, args.page_size),
    get_target_hallmarks: (args) => targetBiology.getTargetHallmarks(args.ensembl_id),
    get_target_depmap_essentiality: (args) => targetBiology.getTargetDepmapEssentiality(args.ensembl_id),
    get_target_interactions: (args) => targetBiology.getTargetInteractions(args.ensembl_id, args.source_database, args.score_threshold, args.page_index, args.page_size),
    // Target Associations
    get_target_associated_diseases: (args) => targetAssociations.getTargetAssociatedDiseases(args.ensembl_id, args.page_index, args.page_size),
    get_target_known_drugs: (args) => targetAssociations.getTargetKnownDrugs(args.ensembl_id, args.page_index, args.page_size),
    get_target_literature_occurrences: (args) => targetAssociations.getTargetLiteratureOccurrences(args.ensembl_id, args.additional_entity_ids, args.start_year, args.end_year, args.start_month, args.end_month, args.cursor, args.size),
    // Target Safety
    get_target_safety_information: (args) => targetSafety.getTargetSafetyInformation(args.ensembl_id),
    get_target_tractability: (args) => targetSafety.getTargetTractability(args.ensembl_id),
    get_target_chemical_probes: (args) => targetSafety.getTargetChemicalProbes(args.ensembl_id),
    get_target_tep: (args) => targetSafety.getTargetTep(args.ensembl_id),
    get_target_prioritization: (args) => targetSafety.getTargetPrioritization(args.ensembl_id),
    // Disease
    get_disease_info: (args) => disease.getDiseaseInfo(args.efo_id),
    get_disease_associated_targets: (args) => disease.getDiseaseAssociatedTargets(args.efo_id, args.page_index, args.page_size),
    get_disease_phenotypes: (args) => disease.getDiseasePhenotypes(args.efo_id, args.page_index, args.page_size),
    get_disease_otar_projects: (args) => disease.getDiseaseOtarProjects(args.efo_id),
    // Drug Identity
    get_drug_info: (args) => drugIdentity.getDrugInfo(args.chembl_id),
    get_drug_cross_references: (args) => drugIdentity.getDrugCrossReferences(args.chembl_id),
    // Drug Associations
    get_drug_linked_diseases: (args) => drugAssociations.getDrugLinkedDiseases(args.chembl_id),
    get_drug_linked_targets: (args) => drugAssociations.getDrugLinkedTargets(args.chembl_id),
    // Drug Safety
    get_drug_adverse_events: (args) => drugSafety.getDrugAdverseEvents(args.chembl_id, args.page_index, args.page_size),
    get_drug_pharmacovigilance: (args) => drugSafety.getDrugPharmacovigilance(args.chembl_id),
    get_drug_warnings: (args) => drugSafety.getDrugWarnings(args.chembl_id),
    // Evidence
    get_target_disease_evidence: (args) => evidence.getTargetDiseaseEvidence(args.ensembl_id, args.efo_id, args.datasource_ids, args.size, args.cursor),
    get_target_disease_biomarkers: (args) => evidence.getTargetDiseaseBiomarkers(args.ensembl_id, args.efo_id, args.size, args.cursor),
    // Search
    search_entities: (args) => search.searchEntities(args.query_string, args.entity_names, args.page_index, args.page_size),
    search_suggestions: (args) => search.searchSuggestions(args.query_prefix, args.entity_names, args.max_suggestions),
    get_similar_targets: (args) => search.getSimilarTargets(args.entity_id, args.threshold, args.size),
    search_facets: (args) => search.searchFacets(args.query_string, args.category_id, args.entity_names, args.page_index, args.page_size),
    // Variant
    get_variant_info: (args) => variant.getVariantInfo(args.variant_id),
    get_variant_credible_sets: (args) => variant.getVariantCredibleSets(args.variant_id, args.study_types, args.page_index, args.page_size),
    get_variant_pharmacogenomics: (args) => variant.getVariantPharmacogenomics(args.variant_id, args.page_index, args.page_size),
    get_variant_evidences: (args) => variant.getVariantEvidences(args.variant_id, args.datasource_ids, args.size, args.cursor),
    get_variant_intervals: (args) => variant.getVariantIntervals(args.variant_id, args.page_index, args.page_size),
    get_variant_protein_coordinates: (args) => variant.getVariantProteinCoordinates(args.variant_id, args.page_index, args.page_size),
    // Study
    get_study_info: (args) => study.getStudyInfo(args.study_id),
    get_studies_by_disease: (args) => study.getStudiesByDisease(args.disease_ids, args.enable_indirect, args.study_id, args.page_index, args.page_size),
    get_study_credible_sets: (args) => study.getStudyCredibleSets(args.study_id, args.page_index, args.page_size),
    get_credible_set_by_id: (args) => study.getCredibleSetById(args.study_locus_id),
    get_credible_set_colocalisation: (args) => study.getCredibleSetColocalisation(args.study_locus_id, args.page_index, args.page_size),
    get_credible_sets: (args) => study.getCredibleSets(args.study_locus_ids, args.study_ids, args.variant_ids, args.study_types, args.regions, args.page_index, args.page_size),
    // Meta
    get_api_metadata: () => meta.getApiMetadata(),
    get_association_datasources: () => meta.getAssociationDatasources(),
    get_interaction_resources: () => meta.getInteractionResources(),
    get_gene_ontology_terms: (args) => meta.getGeneOntologyTerms(args.go_ids),
    map_ids: (args) => meta.mapIds(args.query_terms, args.entity_names),
};
/**
 * Create and configure the MCP server
 */
export function createServer() {
    const server = new Server({
        name: 'open-targets-mcp',
        version: '0.2.0',
    }, {
        capabilities: {
            tools: {},
        },
    });
    // Handle list tools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: toolDefinitions,
        };
    });
    // Handle call tool request
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const handler = toolHandlers[name];
        if (!handler) {
            throw new Error(`Unknown tool: ${name}`);
        }
        try {
            const result = await handler(args || {});
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    });
    return server;
}
/**
 * Run the MCP server with stdio transport
 */
export async function runServer() {
    // Initialize the client
    initializeClient({
        baseUrl: process.env.OPEN_TARGETS_API_URL,
    });
    const server = createServer();
    const transport = new StdioServerTransport();
    // Handle shutdown
    process.on('SIGINT', () => {
        closeClient();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        closeClient();
        process.exit(0);
    });
    await server.connect(transport);
    console.error('Open Targets MCP server running on stdio');
}
//# sourceMappingURL=server.js.map