// Drug Identity API Tools

import { getClient } from '../../client.js';
import {
  DRUG_CROSS_REFERENCES_OPERATION,
  DRUG_INFO_OPERATION,
} from './operations.js';

/**
 * Fetch identity, indication, and mechanism data for a drug.
 */
export async function getDrugInfo(chemblId: string): Promise<unknown> {
  const client = getClient();
  return client.query(DRUG_INFO_OPERATION, { chemblId });
}

/**
 * Retrieve cross-database identifiers related to a drug.
 */
export async function getDrugCrossReferences(chemblId: string): Promise<unknown> {
  const client = getClient();
  return client.query(DRUG_CROSS_REFERENCES_OPERATION, { chemblId });
}
