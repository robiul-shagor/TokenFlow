import { and, asc, desc, eq } from "drizzle-orm";
import { getAddress } from "viem";
import type { Db } from "@/db/client";
import { allocations, indexerCursors, reconciliationReports, reconciliationRows } from "@/db/schema";
import { parseAllocationCsv } from "@/lib/csv";
import { reconcile, type ReconciliationReport, type ReconciliationStatus } from "@/lib/reconcile";
import { computeIndexerStatus } from "@/indexer/health";
import type { Deployment } from "./config";
import { toIndexedAllocation } from "./snapshot";

export interface RunReconciliationInput {
  db: Db;
  deployment: Deployment;
  tokenDecimals: number;
  headBlock: bigint | null;
  csvText: string;
  sourceFilename: string | null;
}

/**
 * Reconcile a CSV against a consistent snapshot of the read model (cursor + allocations read in one
 * REPEATABLE READ transaction), then persist the report. Returns the saved id and the report.
 */
export async function runAndSaveReconciliation(input: RunReconciliationInput) {
  const { db, deployment: d } = input;
  const parsed = parseAllocationCsv(input.csvText, { decimals: input.tokenDecimals, tokenAddress: d.token });
  if (parsed.fileErrors.length > 0) return { ok: false as const, fileErrors: parsed.fileErrors };

  const contract = d.registry.toLowerCase();
  return db.transaction(
    async (tx) => {
      const [cursor] = await tx
        .select()
        .from(indexerCursors)
        .where(and(eq(indexerCursors.chainId, d.chainId), eq(indexerCursors.contractAddress, contract)));
      const rows = await tx
        .select()
        .from(allocations)
        .where(and(eq(allocations.chainId, d.chainId), eq(allocations.contractAddress, contract)));

      const indexedBlock = cursor?.lastProcessedBlock ?? -1n;
      const status = computeIndexerStatus({
        indexedBlock: cursor?.lastProcessedBlock ?? null,
        headBlock: input.headBlock,
        lastRunAt: cursor?.lastRunAt ?? null,
        lastError: cursor?.lastError ?? null,
        now: new Date(),
      });

      const report = reconcile(parsed, rows.map(toIndexedAllocation), {
        chainId: d.chainId,
        contractAddress: d.registry,
        tokenAddress: d.token,
        tokenDecimals: input.tokenDecimals,
        indexedBlock,
        chainHeadBlock: input.headBlock,
        stale: status.stale,
        sourceFilename: input.sourceFilename,
        generatedAt: new Date().toISOString(),
      });

      const [saved] = await tx
        .insert(reconciliationReports)
        .values({
          chainId: d.chainId,
          contractAddress: d.registry,
          tokenAddress: d.token,
          tokenDecimals: input.tokenDecimals,
          indexedBlockNumber: indexedBlock,
          chainHeadBlock: input.headBlock,
          stale: report.meta.stale,
          sourceFilename: input.sourceFilename,
          summaryJson: report.summary,
          createdAt: new Date(report.meta.generatedAt),
        })
        .returning({ id: reconciliationReports.id });

      if (report.rows.length > 0) {
        await tx.insert(reconciliationRows).values(
          report.rows.map((r, position) => ({
            reportId: saved.id,
            position,
            sourceRowNumber: r.sourceRowNumber,
            allocationId: r.allocationId,
            beneficiaryAddress: r.beneficiaryAddress,
            expectedAmountRaw: r.expectedAmountRaw?.toString() ?? null,
            actualAmountRaw: r.actualAmountRaw?.toString() ?? null,
            status: r.status,
            message: r.message,
          })),
        );
      }
      return { ok: true as const, id: saved.id, report };
    },
    { isolationLevel: "repeatable read", accessMode: "read write" },
  );
}

export async function loadReport(db: Db, id: number): Promise<ReconciliationReport | null> {
  const [r] = await db.select().from(reconciliationReports).where(eq(reconciliationReports.id, id));
  if (!r) return null;
  const rows = await db
    .select()
    .from(reconciliationRows)
    .where(eq(reconciliationRows.reportId, id))
    .orderBy(asc(reconciliationRows.position));
  return {
    meta: {
      chainId: r.chainId,
      contractAddress: getAddress(r.contractAddress),
      tokenAddress: getAddress(r.tokenAddress),
      tokenDecimals: r.tokenDecimals,
      indexedBlock: r.indexedBlockNumber,
      chainHeadBlock: r.chainHeadBlock,
      stale: r.stale,
      sourceFilename: r.sourceFilename,
      generatedAt: r.createdAt.toISOString(),
    },
    summary: r.summaryJson as ReconciliationReport["summary"],
    rows: rows.map((x) => ({
      sourceRowNumber: x.sourceRowNumber,
      allocationId: x.allocationId,
      beneficiaryAddress: x.beneficiaryAddress,
      expectedAmountRaw: x.expectedAmountRaw === null ? null : BigInt(x.expectedAmountRaw),
      actualAmountRaw: x.actualAmountRaw === null ? null : BigInt(x.actualAmountRaw),
      status: x.status as ReconciliationStatus,
      message: x.message,
    })),
  };
}

export async function listReports(db: Db, limit = 10) {
  return db
    .select({
      id: reconciliationReports.id,
      sourceFilename: reconciliationReports.sourceFilename,
      indexedBlockNumber: reconciliationReports.indexedBlockNumber,
      stale: reconciliationReports.stale,
      summaryJson: reconciliationReports.summaryJson,
      createdAt: reconciliationReports.createdAt,
    })
    .from(reconciliationReports)
    .orderBy(desc(reconciliationReports.id))
    .limit(limit);
}

/** JSON-safe serialisation of a report (bigint -> string). */
export function serializeReport(id: number, report: ReconciliationReport) {
  return {
    id,
    meta: {
      ...report.meta,
      indexedBlock: report.meta.indexedBlock.toString(),
      chainHeadBlock: report.meta.chainHeadBlock?.toString() ?? null,
    },
    summary: report.summary,
    rows: report.rows.map((r) => ({
      ...r,
      expectedAmountRaw: r.expectedAmountRaw?.toString() ?? null,
      actualAmountRaw: r.actualAmountRaw?.toString() ?? null,
    })),
  };
}
export type SerializedReport = ReturnType<typeof serializeReport>;
