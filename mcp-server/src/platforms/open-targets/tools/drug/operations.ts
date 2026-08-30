/** Complete GraphQL operations shared by drug tools and live API contracts. */

export const DRUG_INFO_OPERATION = `
  query DrugInfo($chemblId: String!) {
    drug(chemblId: $chemblId) {
      id
      name
      synonyms { label source }
      tradeNames { label source }
      drugType
      description
      maximumClinicalStage
      mechanismsOfAction {
        rows {
          mechanismOfAction
          targetName
          targets {
            id
            approvedSymbol
          }
          actionType
          references {
            source
            ids
            urls
          }
        }
      }
      indications {
        rows {
          disease {
            id
            name
            therapeuticAreas { id name }
          }
          maxClinicalStage
        }
        count
      }
    }
  }
`;

export const DRUG_CROSS_REFERENCES_OPERATION = `
  query DrugCrossReferences($chemblId: String!) {
    drug(chemblId: $chemblId) {
      id
      name
      synonyms { label source }
      crossReferences {
        source
        ids
      }
      parentMolecule {
        id
        name
      }
      childMolecules {
        id
        name
        drugType
      }
    }
  }
`;
