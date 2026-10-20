import { and, asc, eq } from "drizzle-orm";
import { getAddress } from "viem";
import { erc20Abi } from "@/lib/abi";
import type { IndexedAllocation } from "@/lib/reconcile";
import { computeIndexerStatus, type IndexerStatus } from "@/indexer/health";
import { getCursor } from "@/indexer/indexer";
import type { Db } from "@/db/client";
import { allocations } from "@/db/schema";
import { getPublicClient, getTokenDecimals, loadDeployment, type Deployment } from "./config";

export interface IndexingMeta {
  chainId: number;
  registry: string;
  token: string;
  tokenDecimals: number | null;
  tokenSymbol: string | null;
  indexedBlock: string | null;
  headBlock: string | null;
  indexer: Omit<IndexerStatus, "lagBlocks"> & { lagBlocks: string | null };
  lastRunAt: string | null;
}

async function headBlockOrNull(): Promise<bigint | null> {
  try {
    return await getPublicClient().getBlockNumber();
  } catch {
    return null;
  }
}

async function tokenInfo(d: Deployment): Promise<{ decimals: number | null; symbol: string | null }> {
  try {
    const symbol = await getPublicClient().readContract({ address: d.token, abi: erc20Abi, functionName: "symbol" });
    return { decimals: await getTokenDecimals(d.token), symbol };
  } catch {
    return { decimals: null, symbol: null };
  }
}

/** Indexing metadata that every read-model response must carry, so the UI can flag stale data. */
export async function getIndexingMeta(db: Db, d: Deployment = loadDeployment()): Promise<IndexingMeta> {
  const [cursor, head, token] = await Promise.all([
    getCursor(db, { chainId: d.chainId, registry: d.registry, deployBlock: d.deployBlock }),
    headBlockOrNull(),
    tokenInfo(d),
  ]);
  const status = computeIndexerStatus({
    indexedBlock: cursor?.lastProcessedBlock ?? null,
    headBlock: head,
    lastRunAt: cursor?.lastRunAt ?? null,
    lastError: cursor?.lastError ?? null,
    now: new Date(),
  });
  return {
    chainId: d.chainId,
    registry: d.registry,
    token: d.token,
    tokenDecimals: token.decimals,
    tokenSymbol: token.symbol,
    indexedBlock: cursor?.lastProcessedBlock.toString() ?? null,
    headBlock: head?.toString() ?? null,
    indexer: { ...status, lagBlocks: status.lagBlocks?.toString() ?? null },
    lastRunAt: cursor?.lastRunAt.toISOString() ?? null,
  };
}

export async function listIndexedAllocations(db: Db, d: Deployment, beneficiary?: string) {
  const conditions = [eq(allocations.chainId, d.chainId), eq(allocations.contractAddress, d.registry.toLowerCase())];
  if (beneficiary) conditions.push(eq(allocations.beneficiary, getAddress(beneficiary)));
  return db
    .select()
    .from(allocations)
    .where(and(...conditions))
    .orderBy(asc(allocations.createdBlock), asc(allocations.allocationId));
}

export function toIndexedAllocation(row: typeof allocations.$inferSelect): IndexedAllocation {
  return {
    allocationId: row.allocationId,
    beneficiary: getAddress(row.beneficiary),
    totalAmountRaw: BigInt(row.totalAmount),
    start: BigInt(row.start),
    cliffDuration: BigInt(row.cliffDuration),
    duration: BigInt(row.duration),
  };
}
