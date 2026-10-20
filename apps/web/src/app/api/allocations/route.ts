import { connection, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { getDb } from "@/db/client";
import { loadDeployment } from "@/server/config";
import { handleRouteError, jsonError } from "@/server/http";
import { getIndexingMeta, listIndexedAllocations } from "@/server/snapshot";

/** Indexed allocations (read model) plus indexing metadata. `?beneficiary=0x…` filters by recipient. */
export async function GET(req: NextRequest) {
  await connection();
  const beneficiary = req.nextUrl.searchParams.get("beneficiary") ?? undefined;
  if (beneficiary !== undefined && !isAddress(beneficiary)) return jsonError(400, "Invalid beneficiary address");
  try {
    const db = getDb();
    const d = loadDeployment();
    const [meta, rows] = await Promise.all([getIndexingMeta(db, d), listIndexedAllocations(db, d, beneficiary)]);
    return Response.json({
      meta,
      allocations: rows.map((r) => ({
        allocationId: r.allocationId,
        allocationIdHex: r.allocationIdHex,
        beneficiary: r.beneficiary,
        totalAmount: r.totalAmount,
        releasedAmount: r.releasedAmount,
        start: r.start,
        cliffDuration: r.cliffDuration,
        duration: r.duration,
        createdBlock: r.createdBlock.toString(),
        createdTxHash: r.createdTxHash,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
