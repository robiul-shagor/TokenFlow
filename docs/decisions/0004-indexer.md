# ADR 0004 — Polling indexer worker inside the web package

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

`pnpm indexer` (`apps/web/scripts/indexer.ts`) polls the local RPC every 2 seconds. The plan says a separate service
is not justified for the MVP. Each batch:

1. Reads the chain head with `cacheTime: 0`, since viem otherwise caches it and catch-up stops early.
2. Verifies that the cursor's stored block hash still matches the chain. If it doesn't, it throws
   `ChainMismatchError`, because Anvil restarted or there was a reorg. The operator then runs `pnpm indexer --reset`.
   This error is never retried automatically.
3. Fetches decoded logs for blocks `cursor+1 … min(head, cursor+batchSize)`.
4. In **one DB transaction**: inserts events with `ON CONFLICT DO NOTHING` on `(chain_id, tx_hash, log_index)`,
   applies `allocations` projections **only for newly inserted events**, and advances the cursor.

Transient failures are retried with exponential backoff (`withRetry`). Because the batch is a single transaction, a
failure leaves no partial state, and a replay is a no-op.

## Consequences

- The indexer is safe to restart or replay at any time (covered by integration tests).
- It has no confirmation depth or automatic reorg handling. That's fine on Anvil, but a public testnet would need a
  confirmation depth and reorg rollback, which is listed as future work.
- The database is a read model. Claimable amounts in the UI always come from the contract's `releasable` view.
