import { and, eq, sql } from "drizzle-orm";
import type { Address, Hex, PublicClient } from "viem";
import { vestingRegistryAbi } from "@/lib/abi";
import { decodeAllocationId } from "@/lib/allocationId";
import type { Db } from "@/db/client";
import { allocations, indexedEvents, indexerCursors } from "@/db/schema";

export interface IndexerTarget {
  chainId: number;
  registry: Address;
  /** First block that can contain registry events. */
  deployBlock: bigint;
}

export interface IndexerDeps extends IndexerTarget {
  db: Db;
  client: Pick<PublicClient, "getBlockNumber" | "getBlock" | "getContractEvents">;
  /** Max blocks per getLogs request / DB transaction. */
  batchSize?: bigint;
  /** Only index blocks at least this deep (latest - confirmations), so short reorgs never reach the DB. */
  confirmations?: bigint;
}

export interface IndexBatchResult {
  fromBlock: bigint | null;
  toBlock: bigint | null;
  headBlock: bigint;
  eventsSeen: number;
  eventsInserted: number;
  caughtUp: boolean;
}

/** The chain no longer contains the block the cursor points at (Anvil restarted or a reorg happened). */
export class ChainMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainMismatchError";
  }
}

const key = (t: IndexerTarget) => ({ chainId: t.chainId, contractAddress: t.registry.toLowerCase() });

export async function getCursor(db: Db, target: IndexerTarget) {
  const k = key(target);
  const [row] = await db
    .select()
    .from(indexerCursors)
    .where(and(eq(indexerCursors.chainId, k.chainId), eq(indexerCursors.contractAddress, k.contractAddress)));
  return row ?? null;
}

/**
 * Index one batch of blocks. Safe to call repeatedly and to replay:
 * - event rows are keyed by (chain_id, tx_hash, log_index) and inserted with ON CONFLICT DO NOTHING;
 * - projections into `allocations` are applied only for newly inserted events;
 * - events, projections and the cursor move are committed in one transaction, so a failure part-way
 *   leaves nothing behind and the batch can simply be retried.
 */
export async function indexBatch(deps: IndexerDeps): Promise<IndexBatchResult> {
  const { db, client } = deps;
  const k = key(deps);
  const batchSize = deps.batchSize ?? 2_000n;
  // cacheTime 0: viem otherwise caches the block number, which would make catch-up stop early.
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const depth = deps.confirmations ?? 0n;
  const headBlock = latest > depth ? latest - depth : 0n;
  const cursor = await getCursor(db, deps);

  if (cursor) {
    if (cursor.lastProcessedBlock > headBlock) {
      throw new ChainMismatchError(
        `Cursor is at block ${cursor.lastProcessedBlock} but the chain head is ${headBlock}. ` +
          `The chain was probably restarted (local Anvil) or reorganised deeper than the confirmation depth; ` +
          `run the indexer with --reset.`,
      );
    }
    const block = await client.getBlock({ blockNumber: cursor.lastProcessedBlock });
    if (block.hash !== cursor.lastProcessedBlockHash) {
      throw new ChainMismatchError(
        `Block ${cursor.lastProcessedBlock} hash changed (${cursor.lastProcessedBlockHash} -> ${block.hash}). ` +
          `The chain was reset or reorganised; run the indexer with --reset.`,
      );
    }
  }

  const lastProcessed = cursor ? cursor.lastProcessedBlock : deps.deployBlock - 1n;
  if (lastProcessed >= headBlock) {
    await db
      .update(indexerCursors)
      .set({ lastRunAt: new Date(), lastError: null })
      .where(and(eq(indexerCursors.chainId, k.chainId), eq(indexerCursors.contractAddress, k.contractAddress)));
    return { fromBlock: null, toBlock: null, headBlock, eventsSeen: 0, eventsInserted: 0, caughtUp: true };
  }

  const fromBlock = lastProcessed + 1n;
  const toBlock = fromBlock + batchSize - 1n < headBlock ? fromBlock + batchSize - 1n : headBlock;

  const logs = await client.getContractEvents({
    address: deps.registry,
    abi: vestingRegistryAbi,
    fromBlock,
    toBlock,
    strict: true,
  });
  const toBlockHash = (await client.getBlock({ blockNumber: toBlock })).hash;

  logs.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );

  let eventsInserted = 0;
  await db.transaction(async (tx) => {
    for (const log of logs) {
      const args = log.args as Record<string, unknown>;
      const allocationIdHex = (args.allocationId as Hex).toLowerCase();
      const payload = Object.fromEntries(
        Object.entries(args).map(([name, value]) => [name, typeof value === "bigint" ? value.toString() : String(value)]),
      );
      const inserted = await tx
        .insert(indexedEvents)
        .values({
          chainId: k.chainId,
          contractAddress: k.contractAddress,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          eventName: log.eventName,
          allocationId: decodeAllocationId(allocationIdHex as Hex),
          decodedPayload: payload,
        })
        .onConflictDoNothing()
        .returning({ id: indexedEvents.id });
      if (inserted.length === 0) continue; // already processed: replay is a no-op
      eventsInserted++;

      if (log.eventName === "ScheduleCreated") {
        const a = log.args;
        await tx
          .insert(allocations)
          .values({
            chainId: k.chainId,
            contractAddress: k.contractAddress,
            allocationIdHex,
            allocationId: decodeAllocationId(a.allocationId),
            beneficiary: a.beneficiary,
            totalAmount: a.totalAmount.toString(),
            start: a.start.toString(),
            cliffDuration: a.cliffDuration.toString(),
            duration: a.duration.toString(),
            createdBlock: log.blockNumber,
            createdTxHash: log.transactionHash.toLowerCase(),
          })
          .onConflictDoNothing();
      } else if (log.eventName === "TokensReleased") {
        await tx
          .update(allocations)
          .set({
            releasedAmount: sql`${allocations.releasedAmount} + ${log.args.amount.toString()}::numeric`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(allocations.chainId, k.chainId),
              eq(allocations.contractAddress, k.contractAddress),
              eq(allocations.allocationIdHex, allocationIdHex),
            ),
          );
      }
    }

    await tx
      .insert(indexerCursors)
      .values({ ...k, lastProcessedBlock: toBlock, lastProcessedBlockHash: toBlockHash, lastError: null })
      .onConflictDoUpdate({
        target: [indexerCursors.chainId, indexerCursors.contractAddress],
        set: {
          lastProcessedBlock: toBlock,
          lastProcessedBlockHash: toBlockHash,
          lastRunAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        },
      });
  });

  return { fromBlock, toBlock, headBlock, eventsSeen: logs.length, eventsInserted, caughtUp: toBlock === headBlock };
}

/** Index batches until caught up with the head observed during the last batch. */
export async function indexToHead(deps: IndexerDeps): Promise<IndexBatchResult[]> {
  const results: IndexBatchResult[] = [];
  for (;;) {
    const r = await indexBatch(deps);
    results.push(r);
    if (r.caughtUp) return results;
  }
}

/** Retry transient failures with exponential backoff. Chain mismatches are not retried. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; onRetry?: (err: unknown, attempt: number) => void } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ChainMismatchError || attempt >= retries) throw err;
      opts.onRetry?.(err, attempt + 1);
      await new Promise((r) => setTimeout(r, (opts.baseDelayMs ?? 500) * 2 ** attempt));
    }
  }
}

export async function recordIndexerError(db: Db, target: IndexerTarget, message: string): Promise<void> {
  const k = key(target);
  await db
    .update(indexerCursors)
    .set({ lastError: message.slice(0, 1000), lastRunAt: new Date() })
    .where(and(eq(indexerCursors.chainId, k.chainId), eq(indexerCursors.contractAddress, k.contractAddress)));
}

/** Delete all indexed data for one chain + contract so it can be rebuilt from the chain. */
export async function resetIndex(db: Db, target: IndexerTarget): Promise<void> {
  const k = key(target);
  await db.transaction(async (tx) => {
    await tx
      .delete(indexedEvents)
      .where(and(eq(indexedEvents.chainId, k.chainId), eq(indexedEvents.contractAddress, k.contractAddress)));
    await tx
      .delete(allocations)
      .where(and(eq(allocations.chainId, k.chainId), eq(allocations.contractAddress, k.contractAddress)));
    await tx
      .delete(indexerCursors)
      .where(and(eq(indexerCursors.chainId, k.chainId), eq(indexerCursors.contractAddress, k.contractAddress)));
  });
}
