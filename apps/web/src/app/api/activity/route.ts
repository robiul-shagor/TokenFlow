import { and, desc, eq, lt, sql } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { getDb } from "@/db/client";
import { indexedEvents } from "@/db/schema";
import { loadDeployment } from "@/server/config";
import { handleRouteError, jsonError } from "@/server/http";

/**
 * Paginated indexed event history, newest first. `?limit=20&before=<id>`; `&beneficiary=0x…` keeps
 * events whose payload names that beneficiary (ScheduleCreated, TokensReleased).
 */
export async function GET(req: NextRequest) {
  await connection();
  const params = req.nextUrl.searchParams;
  const limit = Number(params.get("limit") ?? 20);
  const before = params.get("before");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return jsonError(400, "limit must be 1-100");
  if (before !== null && !/^\d+$/.test(before)) return jsonError(400, "before must be an event id");
  const beneficiary = params.get("beneficiary");
  if (beneficiary !== null && !isAddress(beneficiary)) return jsonError(400, "Invalid beneficiary address");
  try {
    const d = loadDeployment();
    const conditions = [eq(indexedEvents.chainId, d.chainId), eq(indexedEvents.contractAddress, d.registry.toLowerCase())];
    if (before) conditions.push(lt(indexedEvents.id, Number(before)));
    if (beneficiary) {
      conditions.push(sql`lower(${indexedEvents.decodedPayload}->>'beneficiary') = ${beneficiary.toLowerCase()}`);
    }
    const rows = await getDb()
      .select()
      .from(indexedEvents)
      .where(and(...conditions))
      .orderBy(desc(indexedEvents.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return Response.json({
      events: page.map((e) => ({
        id: e.id,
        eventName: e.eventName,
        allocationId: e.allocationId,
        blockNumber: e.blockNumber.toString(),
        transactionHash: e.transactionHash,
        logIndex: e.logIndex,
        payload: e.decodedPayload,
      })),
      nextBefore: rows.length > limit ? page.at(-1)!.id : null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
