export type IndexerState = "synced" | "behind" | "stalled" | "not_started" | "error" | "rpc_unavailable";

export interface IndexerStatusInput {
  indexedBlock: bigint | null;
  headBlock: bigint | null;
  lastRunAt: Date | null;
  lastError: string | null;
  now: Date;
  /** The worker polls every few seconds; if it has not run for this long it is considered stalled. */
  stalledAfterMs?: number;
}

export interface IndexerStatus {
  state: IndexerState;
  lagBlocks: bigint | null;
  /** True when indexed data may not reflect the chain head; reports must say so. */
  stale: boolean;
  message: string;
}

export function computeIndexerStatus(i: IndexerStatusInput): IndexerStatus {
  const stalledAfterMs = i.stalledAfterMs ?? 30_000;
  if (i.headBlock === null) {
    return { state: "rpc_unavailable", lagBlocks: null, stale: true, message: "Local RPC is unreachable" };
  }
  if (i.indexedBlock === null) {
    return { state: "not_started", lagBlocks: null, stale: true, message: "Indexer has not run yet" };
  }
  const lagBlocks = i.headBlock > i.indexedBlock ? i.headBlock - i.indexedBlock : 0n;
  if (i.lastError) {
    return { state: "error", lagBlocks, stale: true, message: `Indexer error: ${i.lastError}` };
  }
  if (lagBlocks === 0n) {
    return { state: "synced", lagBlocks, stale: false, message: `Indexed up to head block ${i.headBlock}` };
  }
  const idleMs = i.lastRunAt ? i.now.getTime() - i.lastRunAt.getTime() : Infinity;
  if (idleMs > stalledAfterMs) {
    return {
      state: "stalled",
      lagBlocks,
      stale: true,
      message: `Indexer is ${lagBlocks} block(s) behind and has not run for ${Math.round(idleMs / 1000)}s. Is \`pnpm indexer\` running?`,
    };
  }
  return { state: "behind", lagBlocks, stale: true, message: `Indexer is ${lagBlocks} block(s) behind the chain head` };
}
