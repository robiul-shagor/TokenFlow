import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { handleRouteError, jsonError } from "@/server/http";
import { loadReport, serializeReport } from "@/server/reports";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/reconciliation/[id]">) {
  await connection();
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return jsonError(400, "Invalid report id");
  try {
    const report = await loadReport(getDb(), Number(id));
    if (!report) return jsonError(404, "Report not found");
    return Response.json(serializeReport(Number(id), report));
  } catch (err) {
    return handleRouteError(err);
  }
}
