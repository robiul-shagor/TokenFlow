import { connection, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { getDb } from "@/db/client";
import { MAX_CSV_BYTES } from "@/lib/csv";
import { getPublicClient, getSafeHeadBlock, getTokenDecimals, loadDeployment, reportSignatureRequired } from "@/server/config";
import { handleRouteError, jsonError, limitPublicRequest, readLimitedText } from "@/server/http";
import { verifyReportAuth } from "@/server/reportAuth";
import { listReports, runAndSaveReconciliation, serializeReport } from "@/server/reports";

interface Body {
  csv?: unknown;
  filename?: unknown;
  chainId?: unknown;
  contractAddress?: unknown;
  /** Required on public networks: { address, signature, issuedAt } from a SCHEDULE_MANAGER_ROLE holder. */
  auth?: unknown;
}

/** Run a reconciliation for the configured deployment and save the report. */
export async function POST(req: Request) {
  await connection();
  const limited = limitPublicRequest(req, "reconcile", 10);
  if (limited) return limited;
  const raw = await readLimitedText(req, MAX_CSV_BYTES + 10_000);
  if (raw === null) return jsonError(413, `CSV must be at most ${MAX_CSV_BYTES} bytes`);
  let body: Body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "Body must be JSON: { csv, filename?, chainId, contractAddress }");
  }
  if (typeof body.csv !== "string") return jsonError(400, "csv must be a string");
  const filename = typeof body.filename === "string" ? body.filename.slice(0, 200) : null;

  try {
    const d = loadDeployment();
    // Never trust a client-provided chain/contract: it must equal the configured local deployment.
    if (body.chainId !== d.chainId) return jsonError(400, `chainId must be ${d.chainId}`);
    if (
      typeof body.contractAddress !== "string" ||
      !isAddress(body.contractAddress) ||
      body.contractAddress.toLowerCase() !== d.registry.toLowerCase()
    ) {
      return jsonError(400, `contractAddress must be the configured registry ${d.registry}`);
    }
    if (reportSignatureRequired()) {
      const auth = await verifyReportAuth({ auth: body.auth, csv: body.csv, deployment: d, client: getPublicClient() });
      if (!auth.ok) return jsonError(auth.status, auth.error);
    }
    const tokenDecimals = await getTokenDecimals(d.token);
    const headBlock = await getSafeHeadBlock().catch(() => null);
    const result = await runAndSaveReconciliation({
      db: getDb(),
      deployment: d,
      tokenDecimals,
      headBlock,
      csvText: body.csv,
      sourceFilename: filename,
    });
    if (!result.ok) return jsonError(422, "CSV file is invalid", { fileErrors: result.fileErrors });
    return Response.json(serializeReport(result.id, result.report), { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Recent reports (summary only). */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const reports = await listReports(getDb(), Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 10) || 10, 50));
    return Response.json({
      reports: reports.map((r) => ({
        ...r,
        indexedBlockNumber: r.indexedBlockNumber.toString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
