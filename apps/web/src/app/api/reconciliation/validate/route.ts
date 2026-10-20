import { connection } from "next/server";
import { MAX_CSV_BYTES, parseAllocationCsv } from "@/lib/csv";
import { getTokenDecimals, loadDeployment } from "@/server/config";
import { handleRouteError, jsonError, readLimitedText } from "@/server/http";

/** Validate CSV content (text/csv body) and return row errors without saving anything. */
export async function POST(req: Request) {
  await connection();
  const text = await readLimitedText(req, MAX_CSV_BYTES);
  if (text === null) return jsonError(413, `CSV must be at most ${MAX_CSV_BYTES} bytes`);
  try {
    const d = loadDeployment();
    const parsed = parseAllocationCsv(text, { decimals: await getTokenDecimals(d.token), tokenAddress: d.token });
    return Response.json({
      fileErrors: parsed.fileErrors,
      totalDataRows: parsed.totalDataRows,
      validRows: parsed.rows.length,
      issues: parsed.issues.map((i) => ({ ...i, expectedAmountRaw: i.expectedAmountRaw?.toString() ?? null })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
