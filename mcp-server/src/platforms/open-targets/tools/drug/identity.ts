import { getClient } from '../../client.js';
import {
  DRUG_CROSS_REFERENCES_OPERATION,
  DRUG_INFO_OPERATION,
} from './operations.js';

export async function getDrugInfo(chemblId: string): Promise<unknown> {
  const client = getClient();
  return client.query(DRUG_INFO_OPERATION, { chemblId });
}

export async function getDrugCrossReferences(chemblId: string): Promise<unknown> {
  const client = getClient();
  return client.query(DRUG_CROSS_REFERENCES_OPERATION, { chemblId });
}
