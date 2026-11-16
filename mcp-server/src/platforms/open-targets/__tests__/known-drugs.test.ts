import { afterEach, expect, it } from 'vitest';
import { closeClient, initializeClient } from '../client.js';
import { toolHandlers as handlers } from '../tools.js';
import { requestRecorder } from '../../__test-utils__/tool-requests.js';

afterEach(closeClient);

const report = (origin: string, source: string, clinicalStage: string) => ({ origin, source, clinicalStage });
const drug = (id: string, name: string, maximumClinicalStage: string, parentMolecule: { id: string; name: string } | null = null) =>
  ({ id, name, drugType: 'Antibody', maximumClinicalStage, description: null, parentMolecule });

// Shapes taken from the live ERBB2 response (2026-11-16).
const rows = [
  { id: 'r1', maxClinicalStage: 'PHASE_4', drug: drug('CHEMBL1201585', 'TRASTUZUMAB', 'APPROVAL'), diseases: [],
    clinicalReports: [report('CLINICAL_TRIAL', 'ClinicalTrials.gov', 'PHASE_4'), report('REGULATORY_AGENCY', 'FDA', 'APPROVAL'),
      report('DRUG_LABEL', 'DailyMed', 'APPROVAL'), report('CURATED_RESOURCE', 'ATC', 'APPROVAL')] },
  { id: 'r2', maxClinicalStage: 'APPROVAL', drug: drug('CHEMBL4298178', 'TRASTUZUMAB DUOCARMAZINE', 'APPROVAL'), diseases: [],
    clinicalReports: [report('CURATED_RESOURCE', 'ATC', 'APPROVAL'), report('CURATED_RESOURCE', 'TTD', 'PHASE_3')] },
  { id: 'r3', maxClinicalStage: 'APPROVAL', drug: drug('CHEMBL1201179', 'LAPATINIB DITOSYLATE', 'APPROVAL', { id: 'CHEMBL554', name: 'LAPATINIB' }), diseases: [],
    clinicalReports: [report('REGULATORY_AGENCY', 'PMDA', 'APPROVAL')] },
  { id: 'r4', maxClinicalStage: 'PHASE_4', drug: drug('CHEMBL554', 'LAPATINIB', 'APPROVAL'), diseases: [],
    clinicalReports: [report('REGULATORY_AGENCY', 'EMA Human Drugs', 'APPROVAL')] },
  { id: 'r5', maxClinicalStage: 'PHASE_3', drug: drug('CHEMBL3647420', 'PYROTINIB', 'APPROVAL'), diseases: [],
    clinicalReports: [report('CLINICAL_TRIAL', 'ClinicalTrials.gov', 'PHASE_3')] },
  { id: 'r6', maxClinicalStage: 'PHASE_2', drug: drug('CHEMBL4297556', 'MM-111', 'PHASE_2'), diseases: [],
    clinicalReports: [report('CLINICAL_TRIAL', 'ClinicalTrials.gov', 'PHASE_2')] },
  { id: 'r7', maxClinicalStage: 'WITHDRAWAL', drug: drug('CHEMBL939', 'GEFITINIB', 'APPROVAL'), diseases: [],
    clinicalReports: [report('REGULATORY_AGENCY', 'EMA Human Drugs', 'APPROVAL'), report('CURATED_RESOURCE', 'TTD', 'WITHDRAWAL')] },
];

interface Row { id: string; approval: { status: string; regulators: string[]; otherApprovalSources: string[]; withdrawalReported: boolean } }
interface Result {
  approvalSummary: {
    regulatorApproved: { count: number; drugs: Array<{ name: string; regulators: string[]; withdrawalReported?: boolean }> };
    approvalUnconfirmed: { count: number; drugs: Array<{ name: string; approvalSources: string[] }> };
  };
  target: { drugAndClinicalCandidates: { count: number; rows: Row[] } };
}

async function read(page_index = 0, page_size = 10) {
  initializeClient({ adapter: requestRecorder({ data: { target: { drugAndClinicalCandidates: { count: rows.length, rows } } } }).adapter });
  return await handlers.get_target_known_drugs!({ ensembl_id: 'ENSG00000141736', page_index, page_size }) as Result;
}

it('approval comes from regulator and label records, not stage labels', async () => {
  const byId = new Map((await read()).target.drugAndClinicalCandidates.rows.map((row) => [row.id, row.approval]));
  // PHASE_4 row of a marketed drug is regulator-approved.
  expect(byId.get('r1')).toEqual({ status: 'REGULATOR_APPROVED', regulators: ['DailyMed', 'FDA'], otherApprovalSources: ['ATC'], withdrawalReported: false });
  // APPROVAL that comes only from a WHO ATC code is not an approval.
  expect(byId.get('r2')).toMatchObject({ status: 'APPROVAL_UNCONFIRMED', regulators: [], otherApprovalSources: ['ATC'] });
  // Drug-level APPROVAL without any record on this row stays unconfirmed (e.g. China-only approvals).
  expect(byId.get('r5')).toMatchObject({ status: 'APPROVAL_UNCONFIRMED', regulators: [] });
  expect(byId.get('r6')).toMatchObject({ status: 'NOT_APPROVED' });
  expect(byId.get('r7')).toMatchObject({ status: 'REGULATOR_APPROVED', withdrawalReported: true });
});

it('summarizes every row once per parent molecule, independent of the page', async () => {
  const full = await read();
  const paged = await read(1, 2);
  expect(paged.target.drugAndClinicalCandidates.rows.map((row) => row.id)).toEqual(['r3', 'r4']);
  expect(paged.approvalSummary).toEqual(full.approvalSummary);
  const { regulatorApproved, approvalUnconfirmed } = full.approvalSummary;
  expect(regulatorApproved.drugs.map((d) => d.name)).toEqual(['GEFITINIB', 'LAPATINIB', 'TRASTUZUMAB']);
  expect(regulatorApproved.count).toBe(3);
  expect(regulatorApproved.drugs.find((d) => d.name === 'LAPATINIB')!.regulators).toEqual(['EMA Human Drugs', 'PMDA']);
  expect(regulatorApproved.drugs.find((d) => d.name === 'GEFITINIB')!.withdrawalReported).toBe(true);
  expect(approvalUnconfirmed.drugs).toEqual([
    { id: 'CHEMBL3647420', name: 'PYROTINIB', approvalSources: ['drug-level stage only, no record'] },
    { id: 'CHEMBL4298178', name: 'TRASTUZUMAB DUOCARMAZINE', approvalSources: ['ATC'] },
  ]);
});

it('does not return the raw clinical reports', async () => {
  const result = await read();
  expect(JSON.stringify(result)).not.toContain('clinicalReports');
});
