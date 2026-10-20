import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { reportToCsv } from "@/lib/reconcile";
import { handleRouteError, jsonError } from "@/server/http";
import { loadReport } from "@/server/reports";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/reconciliation/[id]/export">) {
  await connection();
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return jsonError(400, "Invalid report id");
  try {
    const report = await loadReport(getDb(), Number(id));
    if (!report) return jsonError(404, "Report not found");
    return new Response(reportToCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tokenflow-reconciliation-${id}-block-${report.meta.indexedBlock}.csv"`,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
