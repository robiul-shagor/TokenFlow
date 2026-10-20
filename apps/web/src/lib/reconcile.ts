import type { Address } from "viem";
import type { CsvParseResult } from "./csv";

export const RECONCILIATION_STATUSES = [
  "matched",
  "amount_mismatch",
  "beneficiary_mismatch",
  "schedule_mismatch",
  "missing_onchain",
  "pending_indexing",
  "unexpected_onchain",
  "duplicate_csv",
  "invalid_row",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const STATUS_LABELS: Record<ReconciliationStatus, string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  beneficiary_mismatch: "Beneficiary mismatch",
  schedule_mismatch: "Schedule mismatch",
  missing_onchain: "Missing on-chain",
  pending_indexing: "Cannot verify yet (indexer behind)",
  unexpected_onchain: "On-chain, not in CSV",
  duplicate_csv: "Duplicate CSV row",
  invalid_row: "Invalid CSV row",
};

/** An allocation as seen by the indexer (read model of on-chain ScheduleCreated events). */
export interface IndexedAllocation {
  allocationId: string;
  beneficiary: Address;
  totalAmountRaw: bigint;
  start: bigint;
  cliffDuration: bigint;
  duration: bigint;
}

export interface ReconciliationMeta {
  chainId: number;
  contractAddress: Address;
  tokenAddress: Address;
  tokenDecimals: number;
  /** Highest block whose events are included in the indexed data used for this report. */
  indexedBlock: bigint;
  /** Chain head at report time, if the RPC was reachable. */
  chainHeadBlock: bigint | null;
  /** True when the indexer is behind the chain head (or the head is unknown). */
  stale: boolean;
  sourceFilename: string | null;
  generatedAt: string;
}

export interface ReconciliationRow {
  /** CSV line number, or null for on-chain allocations absent from the CSV. */
  sourceRowNumber: number | null;
  allocationId: string | null;
  beneficiaryAddress: string | null;
  expectedAmountRaw: bigint | null;
  actualAmountRaw: bigint | null;
  status: ReconciliationStatus;
  message: string;
}

export interface ReconciliationReport {
  meta: ReconciliationMeta;
  summary: Record<ReconciliationStatus, number> & { totalRows: number };
  rows: ReconciliationRow[];
}

/**
 * Compare validated CSV records against indexed on-chain allocations. Pure and deterministic: all
 * amounts are bigint, matching key is `allocation_id` (a beneficiary may hold several schedules).
 *
 * If the index is stale, CSV rows not found on-chain become `pending_indexing` instead of
 * `missing_onchain`, because a newer block may contain them.
 */
export function reconcile(
  csv: CsvParseResult,
  onchain: IndexedAllocation[],
  meta: ReconciliationMeta,
): ReconciliationReport {
  if (csv.fileErrors.length > 0) throw new Error(`Cannot reconcile an invalid file: ${csv.fileErrors.join("; ")}`);

  const rows: ReconciliationRow[] = [];
  const byId = new Map(onchain.map((a) => [a.allocationId, a]));
  const seenIds = new Set<string>();

  for (const issue of csv.issues) {
    if (issue.allocationId) seenIds.add(issue.allocationId);
    rows.push({
      sourceRowNumber: issue.rowNumber,
      allocationId: issue.allocationId,
      beneficiaryAddress: issue.beneficiary,
      expectedAmountRaw: issue.expectedAmountRaw,
      actualAmountRaw: issue.allocationId ? (byId.get(issue.allocationId)?.totalAmountRaw ?? null) : null,
      status: issue.kind === "duplicate" ? "duplicate_csv" : "invalid_row",
      message: issue.message,
    });
  }

  for (const row of csv.rows) {
    seenIds.add(row.allocationId);
    const actual = byId.get(row.allocationId);
    const base = {
      sourceRowNumber: row.rowNumber,
      allocationId: row.allocationId,
      beneficiaryAddress: row.beneficiary,
      expectedAmountRaw: row.expectedAmountRaw,
    };
    if (!actual) {
      rows.push({
        ...base,
        actualAmountRaw: null,
        status: meta.stale ? "pending_indexing" : "missing_onchain",
        message: meta.stale
          ? `Not found up to indexed block ${meta.indexedBlock}; the indexer is behind, so it may exist in a newer block`
          : `No on-chain schedule with this allocation_id as of block ${meta.indexedBlock}`,
      });
      continue;
    }

    const problems: string[] = [];
    let status: ReconciliationStatus = "matched";
    if (actual.beneficiary.toLowerCase() !== row.beneficiary.toLowerCase()) {
      problems.push(`beneficiary is ${actual.beneficiary} on-chain`);
      status = "beneficiary_mismatch";
    }
    if (actual.totalAmountRaw !== row.expectedAmountRaw) {
      problems.push(`amount is ${actual.totalAmountRaw} raw units on-chain, CSV expects ${row.expectedAmountRaw}`);
      if (status === "matched") status = "amount_mismatch";
    }
    const scheduleDiffs: string[] = [];
    if (actual.start !== row.start) scheduleDiffs.push(`start ${actual.start} vs ${row.start}`);
    if (actual.cliffDuration !== row.cliffDuration)
      scheduleDiffs.push(`cliff ${actual.cliffDuration}s vs ${row.cliffDuration}s`);
    if (actual.duration !== row.duration) scheduleDiffs.push(`duration ${actual.duration}s vs ${row.duration}s`);
    if (scheduleDiffs.length > 0) {
      problems.push(`schedule differs (on-chain vs CSV): ${scheduleDiffs.join(", ")}`);
      if (status === "matched") status = "schedule_mismatch";
    }

    rows.push({
      ...base,
      actualAmountRaw: actual.totalAmountRaw,
      status,
      message: problems.length === 0 ? "Beneficiary, amount and schedule match" : capitalize(problems.join("; ")),
    });
  }

  for (const a of onchain) {
    if (seenIds.has(a.allocationId)) continue;
    rows.push({
      sourceRowNumber: null,
      allocationId: a.allocationId,
      beneficiaryAddress: a.beneficiary,
      expectedAmountRaw: null,
      actualAmountRaw: a.totalAmountRaw,
      status: "unexpected_onchain",
      message: "On-chain schedule has no corresponding CSV row",
    });
  }

  rows.sort((a, b) => (a.sourceRowNumber ?? Number.MAX_SAFE_INTEGER) - (b.sourceRowNumber ?? Number.MAX_SAFE_INTEGER));

  const summary = Object.fromEntries(RECONCILIATION_STATUSES.map((s) => [s, 0])) as ReconciliationReport["summary"];
  for (const r of rows) summary[r.status]++;
  summary.totalRows = rows.length;

  return { meta, summary, rows };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const EXPORT_HEADER = [
  "source_row_number",
  "allocation_id",
  "beneficiary",
  "expected_amount_raw",
  "actual_amount_raw",
  "status",
  "message",
];

function csvCell(value: string): string {
  // Quote everything that needs it and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Export a report as CSV. Amounts are exact raw integer units; metadata is written as leading comment lines. */
export function reportToCsv(report: ReconciliationReport): string {
  const m = report.meta;
  const lines = [
    `# TokenFlow reconciliation report — LOCAL DEVELOPMENT ONLY`,
    `# chain_id=${m.chainId}`,
    `# contract=${m.contractAddress}`,
    `# token=${m.tokenAddress} decimals=${m.tokenDecimals}`,
    `# indexed_block=${m.indexedBlock} chain_head=${m.chainHeadBlock ?? "unknown"} stale=${m.stale}`,
    `# generated_at=${m.generatedAt}`,
    EXPORT_HEADER.join(","),
  ];
  for (const r of report.rows) {
    lines.push(
      [
        r.sourceRowNumber?.toString() ?? "",
        r.allocationId ?? "",
        r.beneficiaryAddress ?? "",
        r.expectedAmountRaw?.toString() ?? "",
        r.actualAmountRaw?.toString() ?? "",
        r.status,
        r.message,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
