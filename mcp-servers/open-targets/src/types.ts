// Open Targets MCP TypeScript Types

// GraphQL Client Types
export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: GraphQLError[];
}

export interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

// Cache Types
export interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
}

// Pagination Types
export interface PageInput {
  index: number;
  size: number;
}

export interface PaginatedResult<T> {
  count: number;
  rows: T[];
}

// Target Types
export interface Target {
  id: string;
  approvedSymbol: string;
  approvedName: string;
  biotype: string;
  functionDescriptions?: string[];
  synonyms?: TargetSynonyms;
  genomicLocation?: GenomicLocation;
  targetClass?: TargetClass[];
  alternativeGenes?: string[];
  transcripts?: Transcript[];
  dbXrefs?: DbXref[];
}

export interface TargetSynonyms {
  label: string;
  source: string;
}

export interface GenomicLocation {
  chromosome: string;
  start: number;
  end: number;
  strand: number;
}

export interface TargetClass {
  id: number;
  label: string;
  level: string;
}

export interface Transcript {
  id: string;
  biotype: string;
  isCanonical: boolean;
}

export interface DbXref {
  id: string;
  source: string;
}

// Expression Types
export interface Expression {
  tissue: Tissue;
  rna?: RnaExpression;
  protein?: ProteinExpression;
}

export interface Tissue {
  id: string;
  label: string;
  anatomicalSystems?: string[];
  organs?: string[];
}

export interface RnaExpression {
  level: number;
  value: number;
  unit: string;
  zscore: number;
}

export interface ProteinExpression {
  level: number;
  reliability: boolean;
  cellType?: CellType[];
}

export interface CellType {
  level: number;
  name: string;
  reliability: boolean;
}

// Pathway Types
export interface Pathway {
  pathway: string;
  pathwayId: string;
  topLevelTerm: string;
}

export interface GoTerm {
  id: string;
  term: {
    id: string;
    name: string;
  };
  aspect: string;
  evidence: string;
  geneProduct: string;
  source: string;
}

// Homologue Types
export interface Homologue {
  homologyType: string;
  speciesId: string;
  speciesName: string;
  targetGeneId: string;
  targetGeneSymbol: string;
  isHighConfidence: string;
  queryPercentageIdentity: number;
  targetPercentageIdentity: number;
}

// Subcellular Location Types
export interface SubcellularLocation {
  location: string;
  source: string;
  termSL: string;
  labelSL: string;
}

// Genetic Constraint Types
export interface GeneticConstraint {
  constraintType: string;
  score: number;
  exp: number;
  obs: number;
  oe: number;
  oeLower: number;
  oeUpper: number;
}

// Mouse Phenotype Types
export interface MousePhenotype {
  modelPhenotypeId: string;
  modelPhenotypeLabel: string;
  modelPhenotypeClasses: PhenotypeClass[];
  biologicalModels: BiologicalModel[];
}

export interface PhenotypeClass {
  id: string;
  label: string;
}

export interface BiologicalModel {
  id: string;
  allelicComposition: string;
  geneticBackground: string;
  literature?: string[];
}

// Cancer Hallmark Types
export interface Hallmark {
  name: string;
  description: string;
  promote: boolean;
  suppress: boolean;
  pubmedId?: number;
  label?: string;
}

// Essentiality Types
export interface DepMapEssentiality {
  screens: EssentialityScreen[];
}

export interface EssentialityScreen {
  depmapId: string;
  expression: number;
  geneEffect: number;
  cellLineName: string;
  diseaseCellLineId: string;
  diseaseFromSource: string;
  mutation: string;
}

// Interaction Types
export interface Interaction {
  intA: string;
  intABiologicalRole: string;
  targetA?: InteractionTarget;
  intB: string;
  intBBiologicalRole: string;
  targetB?: InteractionTarget;
  score: number;
  count: number;
  sourceDatabase: string;
  speciesA?: Species;
  speciesB?: Species;
  evidences: InteractionEvidence[];
}

export interface InteractionTarget {
  id: string;
  approvedSymbol: string;
}

export interface Species {
  mnemonic: string;
  scientificName: string;
  taxonId: number;
}

export interface InteractionEvidence {
  interactionDetectionMethodMiIdentifier: string;
  interactionDetectionMethodShortName: string;
  hostOrganismScientificName: string;
  participantDetectionMethodA: string[];
  participantDetectionMethodB: string[];
  pubmedId: string;
  intASource: string;
  intBSource: string;
  expansionMethodMiIdentifier: string;
  expansionMethodShortName: string;
  interactionIdentifier: string;
  interactionScore: number;
  interactionTypeMiIdentifier: string;
  interactionTypeShortName: string;
}

// Safety Types
export interface SafetyLiability {
  event: string;
  eventId: string;
  effects: SafetyEffect[];
  datasource: string;
  literature?: string;
  url?: string;
  studies?: SafetyStudy[];
  biosamples?: SafetyBiosample[];
}

export interface SafetyEffect {
  direction: string;
  dosing: string;
}

export interface SafetyStudy {
  description: string;
  name: string;
  type: string;
}

export interface SafetyBiosample {
  cellFormat: string;
  cellLabel: string;
  tissueId: string;
  tissueLabel: string;
}

// Tractability Types
export interface Tractability {
  id: string;
  modality: string;
  value: boolean;
}

// Chemical Probe Types
export interface ChemicalProbe {
  id: string;
  control: string;
  drugId: string;
  inchiKey: string;
  isHighQuality: boolean;
  mechanismOfAction: string[];
  origin: string[];
  probeMinerScore: number;
  probesDrugsScore: number;
  scoreInCells: number;
  scoreInOrganisms: number;
  targetFromSource: string;
  urls: ProbeUrl[];
}

export interface ProbeUrl {
  niceName: string;
  url: string;
}

// TEP Types
export interface Tep {
  name: string;
  uri: string;
  description: string;
  therapeuticArea: string;
}

// Prioritization Types
export interface Prioritization {
  items: PrioritizationItem[];
}

export interface PrioritizationItem {
  key: string;
  value: number;
}

// Disease Types
export interface Disease {
  id: string;
  name: string;
  description?: string;
  synonyms?: DiseaseSynonym[];
  parents?: string[];
  children?: string[];
  therapeuticAreas?: TherapeuticArea[];
  ontology?: Ontology;
  dbXRefs?: string[];
  directLocationIds?: string[];
  indirectLocationIds?: string[];
}

export interface DiseaseSynonym {
  relation: string;
  terms: string[];
}

export interface TherapeuticArea {
  id: string;
  name: string;
}

export interface Ontology {
  isTherapeuticArea: boolean;
  leaf: boolean;
  sources: string[];
}

// Phenotype Types
export interface Phenotype {
  id: string;
  name: string;
  url: string;
}

// Drug Types
export interface Drug {
  id: string;
  name: string;
  drugType: string;
  isApproved?: boolean;
  description?: string;
  maximumClinicalTrialPhase?: number;
  hasBeenWithdrawn?: boolean;
  blackBoxWarning?: boolean;
  parentId?: string;
  childChemblIds?: string[];
  synonyms?: string[];
  tradeNames?: string[];
  yearOfFirstApproval?: number;
  crossReferences?: DrugCrossReference;
  mechanismsOfAction?: MechanismOfAction;
  linkedTargets?: LinkedTargets;
  linkedDiseases?: LinkedDiseases;
  indications?: Indications;
}

export interface DrugCrossReference {
  source: string;
  reference: string[];
}

export interface MechanismOfAction {
  rows: MechanismOfActionRow[];
  uniqueActionTypes: string[];
  uniqueTargetTypes: string[];
}

export interface MechanismOfActionRow {
  mechanismOfAction: string;
  actionType: string;
  targets: MechanismTarget[];
  targetName: string;
  references: MechanismReference[];
}

export interface MechanismTarget {
  id: string;
  approvedSymbol: string;
}

export interface MechanismReference {
  source: string;
  ids: string[];
  urls: string[];
}

export interface LinkedTargets {
  count: number;
  rows: LinkedTarget[];
}

export interface LinkedTarget {
  id: string;
  approvedSymbol: string;
  approvedName: string;
}

export interface LinkedDiseases {
  count: number;
  rows: LinkedDisease[];
}

export interface LinkedDisease {
  id: string;
  name: string;
}

export interface Indications {
  count: number;
  rows: Indication[];
}

export interface Indication {
  disease: {
    id: string;
    name: string;
  };
  maxPhaseForIndication: number;
  references: IndicationReference[];
}

export interface IndicationReference {
  source: string;
  ids: string[];
}

// Adverse Event Types
export interface AdverseEvent {
  name: string;
  meddraCode: string;
  count: number;
  logLR: number;
  criticalValue: number;
}

// Pharmacovigilance Types
export interface Pharmacovigilance {
  isBlackBoxWarning: boolean;
  adverseEffectsActivities?: AdverseEffectActivity;
  adverseEffectsOrgans?: AdverseEffectOrgan;
  significantAdverseEvents: AdverseEvent[];
}

export interface AdverseEffectActivity {
  loLevels?: string[];
  activities?: string[];
}

export interface AdverseEffectOrgan {
  loLevels?: string[];
  organsSystemsAffected?: string[];
}

// Warning Types
export interface DrugWarning {
  warningType: string;
  description: string;
  country: string;
  year: number;
  toxicityClass: string;
  efoId: string;
  efoTerm: string;
  meddraSocCode: string;
  references: WarningReference[];
}

export interface WarningReference {
  id: string;
  source: string;
  url: string;
}

// Association Types
export interface Association {
  score: number;
  datatypeScores: DatatypeScore[];
}

export interface DatatypeScore {
  id: string;
  score: number;
}

export interface TargetDiseaseAssociation extends Association {
  disease: {
    id: string;
    name: string;
  };
}

export interface DiseaseTargetAssociation extends Association {
  target: Target;
}

// Evidence Types
export interface Evidence {
  id: string;
  score: number;
  datasourceId: string;
  datatypeId: string;
  target: {
    id: string;
    approvedSymbol: string;
  };
  disease: {
    id: string;
    name: string;
  };
  variantId?: string;
  variantRsId?: string;
  studyId?: string;
  publicationYear?: number;
  publicationFirstAuthor?: string;
  literature?: string[];
  cohortShortName?: string;
  targetFromSourceId?: string;
  diseaseFromSourceMappedId?: string;
  diseaseFromSource?: string;
  urls?: EvidenceUrl[];
}

export interface EvidenceUrl {
  niceName: string;
  url: string;
}

// Biomarker Types
export interface Biomarker {
  id: string;
  geneExpression: {
    name: string;
    id: string;
  };
  variant: {
    id: string;
    functionalConsequenceId: string;
    name: string;
  };
  drug: {
    name: string;
    id: string;
    drugType: string;
  };
  diseaseFromSource: string;
  diseaseFromSourceId: string;
  disease: {
    id: string;
    name: string;
  };
  drugResponse: {
    name: string;
    id: string;
  };
  confidence: string;
  source: {
    url: string;
    name: string;
    link: string;
    label: string;
  };
}

// Search Types
export interface SearchResult {
  total: number;
  hits: SearchHit[];
}

export interface SearchHit {
  id: string;
  entity: string;
  name: string;
  description?: string;
  score: number;
  highlights: string[];
  object: Target | Disease | Drug;
}

export interface SearchSuggestion {
  id: string;
  name: string;
  entity: string;
  score?: number;
  fuzzyScore?: number;
}

export interface Facet {
  category: string;
  total: number;
}

// Variant Types
export interface Variant {
  id: string;
  rsId?: string;
  chromosome: string;
  position: number;
  refAllele: string;
  altAllele: string;
  mostSevereConsequence?: string;
  gnomad?: GnomadData;
  transcriptConsequences?: TranscriptConsequence[];
  alleleFrequencies?: AlleleFrequency[];
}

export interface GnomadData {
  af: number;
  afr: number;
  amr: number;
  asj: number;
  eas: number;
  fin: number;
  nfe: number;
  nfeEst: number;
  nfeNwe: number;
  nfeOnf: number;
  nfeSeu: number;
  oth: number;
  sas: number;
}

export interface TranscriptConsequence {
  transcriptId: string;
  biotype: string;
  variantFunctionalConsequenceId: string;
  consequenceScore: number;
  isEnsemblCanonical: boolean;
  aminoAcidChange?: string;
  codons?: string;
  distance?: number;
  exonRank?: string;
  impact?: string;
  polyphenPrediction?: string;
  polyphenScore?: number;
  siftPrediction?: string;
  siftScore?: number;
  lofteePrediction?: string;
}

export interface AlleleFrequency {
  populationName: string;
  alleleFrequency: number;
}

// Credible Set Types
export interface CredibleSet {
  studyLocusId: string;
  locusStart?: number;
  locusEnd?: number;
  finemappingMethod?: string;
  confidence?: string;
  pValueMantissa?: number;
  pValueExponent?: number;
  credibleSetIndex?: number;
  beta?: number;
  standardError?: number;
  effectAlleleFrequencyFromSource?: number;
  locus?: LocusVariant[];
  study?: Study;
  variant?: Variant;
}

export interface LocusVariant {
  variantId: string;
  posteriorProbability: number;
  pValueMantissa: number;
  pValueExponent: number;
  beta: number;
  standardError: number;
  is95CredibleSet: boolean;
  is99CredibleSet: boolean;
  r2Overall?: number;
}

// Pharmacogenomics Types
export interface PharmacogenomicsVariant {
  datasourceId: string;
  drugFromSource: string;
  drugId?: string;
  evidenceLevel: string;
  genotypeId?: string;
  genotype?: string;
  genotypeAnnotationText?: string;
  haplotypeFromSourceId?: string;
  haplotypeId?: string;
  literature?: string[];
  pgxCategory?: string;
  phenotypeFromSourceId?: string;
  phenotypeText?: string;
  studyId?: string;
  targetFromSourceId?: string;
  variantFunctionalConsequenceId?: string;
  variantRsId?: string;
}

// Study Types
export interface Study {
  studyId: string;
  studyType: string;
  traitFromSource: string;
  traitFromSourceMappedIds?: string[];
  condition?: string;
  publicationFirstAuthor?: string;
  publicationDate?: string;
  publicationJournal?: string;
  pubmedId?: string;
  nCases?: number;
  nControls?: number;
  nSamples?: number;
  initialSampleSize?: string;
  replicationSampleSize?: string;
  summarystatsLocation?: string;
  hasSumstats?: boolean;
  qualityControls?: string[];
  analysisFlags?: string[];
  ldPopulationStructure?: LdPopulationStructure[];
  biosample?: Biosample;
  target?: Target;
  diseases?: Disease[];
}

export interface LdPopulationStructure {
  ldPopulation: string;
  relativeSampleSize: number;
}

export interface Biosample {
  biosampleId?: string;
  biosampleName?: string;
}

// Colocalisation Types
export interface Colocalisation {
  leftStudyLocusId: string;
  rightStudyLocusId: string;
  chromosome: string;
  colocalisationMethod: string;
  h3?: number;
  h4?: number;
  clpp?: number;
  log2h4h3?: number;
  rightStudy?: Study;
  rightVariant?: Variant;
}

// Literature Types
export interface LiteratureOccurrence {
  pmid: string;
  pmcid?: string;
  publicationDate?: string;
  sentences?: Sentence[];
}

export interface Sentence {
  dStart: number;
  dEnd: number;
  tStart: number;
  tEnd: number;
  text: string;
  section: string;
}

// Meta/API Types
export interface ApiMetadata {
  name: string;
  apiVersion: ApiVersion;
  dataVersion: DataVersion;
}

export interface ApiVersion {
  x: number;
  y: number;
  z: number;
}

export interface DataVersion {
  year: number;
  month: number;
  iteration: number;
}

export interface Datasource {
  id: string;
  name: string;
  description: string;
  weight: number;
  dataType: string;
}

export interface InteractionResource {
  databaseVersion?: string;
  sourceDatabase: string;
}

// Tool Definition Types (for MCP)
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

// OTAR Project Types
export interface OtarProject {
  otarCode: string;
  projectName: string;
  status: string;
  integratesInPPP: boolean;
  reference: string;
}
