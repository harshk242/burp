export const TARGET_INFO_OPERATION = `
  query TargetInfo($ensemblId: String!) {
    target(ensemblId: $ensemblId) {
      id
      approvedSymbol
      approvedName
      biotype
      functionDescriptions
      synonyms { label source }
      genomicLocation { chromosome start end strand }
      proteinIds { id source }
    }
  }
`;

export const TARGET_ASSOCIATED_DISEASES_OPERATION = `
  query TargetAssociatedDiseases($ensemblId: String!, $pageIndex: Int!, $pageSize: Int!) {
    target(ensemblId: $ensemblId) {
      associatedDiseases(page: {index: $pageIndex, size: $pageSize}) {
        count
        rows {
          disease { id name description therapeuticAreas { id name } }
          score
          datatypeScores { id score }
        }
      }
    }
  }
`;
