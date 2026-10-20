# ADR 0002 — PostgreSQL with Drizzle ORM

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The plan allows Prisma or Drizzle; we pick one. When the project started, the `latest` npm tag for `prisma` was an
8.0 release candidate, and Prisma 7 changed client generation and driver configuration significantly.

## Decision

Use **Drizzle ORM 0.45** with the `postgres` (postgres.js) driver, and `drizzle-kit` for SQL migrations, which are
committed in `apps/web/drizzle/`.

- Token amounts and uint64 schedule fields use `NUMERIC(78,0)` / `NUMERIC(20,0)`. They are read back as strings and
  converted to `bigint`. No floating-point columns.
- The event idempotency key is a unique constraint on `(chain_id, transaction_hash, log_index)`.
- Reconciliation reads the cursor and allocations in one `REPEATABLE READ` transaction, so a report is a consistent
  snapshot at a single indexed block.

## Consequences

- There is no generated client step. The schema is TypeScript (`src/db/schema.ts`).
- Raw SQL is needed for `released_amount + x` updates. That is acceptable, and it is parameterised.
