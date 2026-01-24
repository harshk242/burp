// Target Biology API Tools
import { getClient } from '../../client.js';
import { filterNoneValues } from '../../utils.js';
/**
 * Return RNA and protein expression profiles for a target across tissues.
 */
export async function getTargetExpression(ensemblId) {
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
/**
 * List pathway memberships and Gene Ontology annotations for a target.
 */
export async function getTargetPathwaysAndGoTerms(ensemblId, _pageIndex = 0, _pageSize = 10) {
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
/**
 * Retrieve cross-species homologues for a target gene.
 */
export async function getTargetHomologues(ensemblId) {
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
/**
 * Return subcellular localisation annotations for a target.
 */
export async function getTargetSubcellularLocations(ensemblId) {
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
/**
 * Fetch genetic constraint metrics (gnomAD) for a target.
 */
export async function getTargetGeneticConstraint(ensemblId) {
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
/**
 * Retrieve mouse knockout phenotypes associated with a target.
 */
export async function getTargetMousePhenotypes(ensemblId, _pageIndex = 0, _pageSize = 10) {
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
/**
 * Return cancer hallmark annotations associated with a target.
 */
export async function getTargetHallmarks(ensemblId) {
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
/**
 * Fetch DepMap CRISPR essentiality scores across cell lines.
 */
export async function getTargetDepmapEssentiality(ensemblId) {
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
/**
 * Retrieve protein interaction partners for a target from curated databases.
 */
export async function getTargetInteractions(ensemblId, sourceDatabase, scoreThreshold, pageIndex = 0, pageSize = 10) {
    const client = getClient();
    const query = `
    query TargetInteractions(
      $ensemblId: String!,
      $sourceDatabase: String,
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
//# sourceMappingURL=biology.js.map