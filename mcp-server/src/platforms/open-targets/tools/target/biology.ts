import { getClient } from '../../client.js';
import { filterNoneValues } from '../../utils.js';

export async function getTargetExpression(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetExpression($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        expressions {
          tissue { id, label, organs, anatomicalSystems }
          rna { level, unit, value, zscore }
          protein { level, reliability, cellType { name, level, reliability } }
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetPathwaysAndGoTerms(
  ensemblId: string,
  _pageIndex: number = 0,
  _pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetPathwaysAndGOTerms($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        pathways {
          pathway
          pathwayId
          topLevelTerm
        }
        geneOntology {
          aspect
          geneProduct
          evidence
          source
          term {
            id
            name
          }
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetHomologues(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetHomologues($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        homologues {
          speciesId
          speciesName
          targetGeneId
          targetGeneSymbol
          homologyType
          queryPercentageIdentity
          targetPercentageIdentity
          isHighConfidence
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetSubcellularLocations(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetSubcellularLocations($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        subcellularLocations {
          location
          source
          termSL
          labelSL
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetGeneticConstraint(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetConstraint($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        geneticConstraint {
          constraintType
          score
          exp
          obs
          oe
          oeLower
          oeUpper
          upperBin
          upperBin6
          upperRank
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetMousePhenotypes(
  ensemblId: string,
  _pageIndex: number = 0,
  _pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetMousePhenotypes($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        mousePhenotypes {
          modelPhenotypeId
          modelPhenotypeLabel
          biologicalModels {
            id
            allelicComposition
            geneticBackground
          }
          modelPhenotypeClasses {
            id
            label
          }
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetHallmarks(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetHallmarks($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        hallmarks {
          attributes {
            name
            description
            pmid
          }
          cancerHallmarks {
            label
            impact
            description
            pmid
          }
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetDepmapEssentiality(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetDepMapEssentiality($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        isEssential
        depMapEssentiality {
          tissueId
          tissueName
          screens {
            depmapId
            cellLineName
            diseaseCellLineId
            diseaseFromSource
            geneEffect
            expression
            mutation
          }
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetInteractions(
  ensemblId: string,
  sourceDatabase?: string,
  scoreThreshold?: number,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetInteractions(
      $ensemblId: String!,
      $sourceDatabase: InteractionSourceEnum,
      $scoreThreshold: Float,
      $pageIndex: Int!,
      $pageSize: Int!
    ) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        interactions(
          sourceDatabase: $sourceDatabase,
          scoreThreshold: $scoreThreshold,
          page: {index: $pageIndex, size: $pageSize}
        ) {
          count
          rows {
            intA
            intB
            score
            sourceDatabase
            targetA { id, approvedSymbol }
            targetB { id, approvedSymbol }
            evidences {
              interactionIdentifier
              interactionDetectionMethodShortName
              hostOrganismScientificName
              participantDetectionMethodA { miIdentifier, shortName }
              participantDetectionMethodB { miIdentifier, shortName }
            }
          }
        }
      }
    }
  `;
  const variables = filterNoneValues({
    ensemblId,
    sourceDatabase,
    scoreThreshold,
    pageIndex,
    pageSize,
  });
  return client.query(query, variables);
}
