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

export interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
}

export interface PageInput {
  index: number;
  size: number;
}

export interface PaginatedResult<T> {
  count: number;
  rows: T[];
}

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
  strand: Strand;
}

export type Strand = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';

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

export interface SubcellularLocation {
  location: string;
  source: string;
  termSL: string;
  labelSL: string;
}

export interface GeneticConstraint {
  constraintType: string;
  score: number;
  exp: number;
  obs: number;
  oe: number;
  oeLower: number;
  oeUpper: number;
}

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

export interface Hallmark {
  name: string;
  description: string;
  promote: boolean;
  suppress: boolean;
  pubmedId?: number;
  label?: string;
}

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

export interface Tractability {
  id: string;
  modality: string;
  value: boolean;
}

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

export interface Tep {
  name: string;
  uri: string;
  description: string;
  therapeuticArea: string;
}

export interface Prioritization {
  items: PrioritizationItem[];
}

export interface PrioritizationItem {
  key: string;
  value: number;
}

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

export interface Phenotype {
  id: string;
  name: string;
  url: string;
}

export interface DrugLabelAndSource {
  label: string;
  source: string;
}

export interface Drug {
  id: string;
  name: string;
  drugType: string;
  description?: string;
  maximumClinicalStage?: string;
  parentId?: string;
  childChemblIds?: string[];
  synonyms?: DrugLabelAndSource[];
  tradeNames?: DrugLabelAndSource[];
  crossReferences?: DrugCrossReference;
  mechanismsOfAction?: MechanismOfAction;
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

export interface Indications {
  count: number;
  rows: Indication[];
}

export interface Indication {
  disease: {
    id: string;
    name: string;
  };
  maxClinicalStage: string;
}

export interface AdverseEvent {
  name: string;
  meddraCode: string;
  count: number;
  logLR: number;
  criticalValue: number;
}

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

export interface OtarProject {
  otarCode: string;
  projectName: string;
  status: string;
  integratesInPPP: boolean;
  reference: string;
}
