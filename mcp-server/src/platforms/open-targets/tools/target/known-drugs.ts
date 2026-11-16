import { getClient } from '../../client.js';
import { paginateTargetLists } from './pagination.js';

/**
 * Open Targets stage labels are not regulatory status. A target–drug row's `maxClinicalStage`
 * is the highest stage among its clinical reports, where PHASE_4 ranks above APPROVAL, and an
 * APPROVAL report may come from a curated classification (WHO ATC code, TTD) rather than a
 * regulator: trastuzumab duocarmazine has APPROVAL only from its ATC code and was never approved,
 * while trastuzumab's row reads PHASE_4. The report `origin` says which kind of record it is,
 * so approval is derived here from regulator and drug-label reports only.
 */
const REGULATOR_ORIGINS: ReadonlySet<string> = new Set(['REGULATORY_AGENCY', 'DRUG_LABEL']);
const APPROVAL_LIKE_STAGES: ReadonlySet<string> = new Set(['APPROVAL', 'PHASE_4', 'WITHDRAWAL']);

const SUMMARY_DEFINITION =
  'Distinct drugs, salts merged into their parent molecule. regulatorApproved: at least one '
  + 'APPROVAL record from a regulatory agency (FDA, EMA, PMDA) or a drug label (DailyMed, US) '
  + 'for this target and drug, in any jurisdiction or indication. approvalUnconfirmed: an '
  + 'approval label comes only from a curated classification (WHO ATC code, TTD), a trial record '
  + 'or the drug-level stage; the drug may never have been approved (ATC codes can be assigned '
  + 'before approval) or may be approved by a regulator Open Targets does not cover (e.g. '
  + 'China NMPA). Verify approvalUnconfirmed drugs before calling them approved.';

/** Approval label with no record behind it on this target–drug pair. */
const DRUG_STAGE_ONLY = 'drug-level stage only, no record';

type ApprovalStatus = 'REGULATOR_APPROVED' | 'APPROVAL_UNCONFIRMED' | 'NOT_APPROVED';

interface ClinicalReport {
  origin?: string | null;
  source?: string | null;
  clinicalStage?: string | null;
}

interface MoleculeRef {
  id: string;
  name: string;
}

interface KnownDrugRow {
  id: string;
  maxClinicalStage?: string | null;
  drug?: (MoleculeRef & {
    drugType?: string | null;
    maximumClinicalStage?: string | null;
    description?: string | null;
    parentMolecule?: MoleculeRef | null;
  }) | null;
  clinicalReports?: ClinicalReport[] | null;
  diseases?: unknown;
}

interface KnownDrugsResponse {
  target?: {
    drugAndClinicalCandidates?: { count: number; rows: KnownDrugRow[] } | null;
  } | null;
}

export interface DrugApproval {
  status: ApprovalStatus;
  /** Sources of regulator or drug-label APPROVAL records (e.g. FDA, EMA Human Drugs, DailyMed). */
  regulators: string[];
  /** Sources of APPROVAL labels that are not regulator records (e.g. ATC, TTD). */
  otherApprovalSources: string[];
  withdrawalReported: boolean;
}

const uniqueSorted = (values: Iterable<string>) => [...new Set(values)].sort();

export function classifyApproval(row: KnownDrugRow): DrugApproval {
  const reports = row.clinicalReports ?? [];
  const approvals = reports.filter((report) => report.clinicalStage === 'APPROVAL');
  const sourceOf = (report: ClinicalReport) => report.source ?? report.origin ?? 'unknown';
  const regulators = uniqueSorted(approvals
    .filter((report) => REGULATOR_ORIGINS.has(report.origin ?? ''))
    .map(sourceOf));
  const otherApprovalSources = uniqueSorted(approvals
    .filter((report) => !REGULATOR_ORIGINS.has(report.origin ?? ''))
    .map(sourceOf));
  const drugStage = row.drug?.maximumClinicalStage ?? '';
  const rowStage = row.maxClinicalStage ?? '';
  const withdrawalReported = rowStage === 'WITHDRAWAL' || drugStage === 'WITHDRAWAL'
    || reports.some((report) => report.clinicalStage === 'WITHDRAWAL');
  const approvalLabelled = otherApprovalSources.length > 0
    || APPROVAL_LIKE_STAGES.has(drugStage) || APPROVAL_LIKE_STAGES.has(rowStage);
  const status: ApprovalStatus = regulators.length > 0
    ? 'REGULATOR_APPROVED'
    : approvalLabelled ? 'APPROVAL_UNCONFIRMED' : 'NOT_APPROVED';
  return { status, regulators, otherApprovalSources, withdrawalReported };
}

interface SummaryEntry {
  id: string;
  name: string;
  status: ApprovalStatus;
  sources: Set<string>;
  withdrawalReported: boolean;
}

const STATUS_RANK: Record<ApprovalStatus, number> = {
  REGULATOR_APPROVED: 2, APPROVAL_UNCONFIRMED: 1, NOT_APPROVED: 0,
};

/** One counting definition for "approved drugs for this target", over every row. */
export function summarizeApprovals(rows: Array<KnownDrugRow & { approval: DrugApproval }>) {
  const byParent = new Map<string, SummaryEntry>();
  for (const row of rows) {
    if (!row.drug) continue;
    const parent = row.drug.parentMolecule ?? row.drug;
    const { status, regulators, otherApprovalSources, withdrawalReported } = row.approval;
    const sources = status === 'REGULATOR_APPROVED' ? regulators : otherApprovalSources;
    const entry = byParent.get(parent.id);
    if (!entry || STATUS_RANK[status] > STATUS_RANK[entry.status]) {
      byParent.set(parent.id, {
        id: parent.id, name: parent.name, status, sources: new Set(sources),
        withdrawalReported: withdrawalReported || (entry?.withdrawalReported ?? false),
      });
    } else {
      if (status === entry.status) for (const source of sources) entry.sources.add(source);
      entry.withdrawalReported ||= withdrawalReported;
    }
  }
  const list = (status: ApprovalStatus, key: 'regulators' | 'approvalSources') => {
    const drugs = [...byParent.values()]
      .filter((entry) => entry.status === status)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        [key]: entry.sources.size > 0 ? uniqueSorted(entry.sources) : [DRUG_STAGE_ONLY],
        ...(entry.withdrawalReported ? { withdrawalReported: true } : {}),
      }));
    return { count: drugs.length, drugs };
  };
  return {
    definition: SUMMARY_DEFINITION,
    regulatorApproved: list('REGULATOR_APPROVED', 'regulators'),
    approvalUnconfirmed: list('APPROVAL_UNCONFIRMED', 'approvalSources'),
  };
}

const KNOWN_DRUGS_QUERY = `
  query TargetKnownDrugs($ensemblId: String!) {
    target(ensemblId: $ensemblId) {
      drugAndClinicalCandidates {
        count
        rows {
          id
          maxClinicalStage
          drug {
            id
            name
            drugType
            maximumClinicalStage
            description
            parentMolecule { id name }
          }
          clinicalReports { origin source clinicalStage }
          diseases {
            disease {
              id
              name
            }
          }
        }
      }
    }
  }
`;

export async function getTargetKnownDrugs(
  ensemblId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const data = await getClient().query<KnownDrugsResponse>(KNOWN_DRUGS_QUERY, { ensemblId });
  const candidates = data.target?.drugAndClinicalCandidates;
  if (!candidates) return data;
  // Reports are only needed for classification; dropping them keeps the result small.
  const rows = candidates.rows.map(({ clinicalReports, ...row }) => ({
    ...row,
    approval: classifyApproval({ ...row, clinicalReports: clinicalReports ?? null }),
  }));
  const result = {
    approvalSummary: summarizeApprovals(rows),
    target: { ...data.target, drugAndClinicalCandidates: { ...candidates, rows } },
  };
  return paginateTargetLists(result, ['drugAndClinicalCandidates.rows'], pageIndex, pageSize);
}
