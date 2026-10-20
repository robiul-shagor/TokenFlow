# ADR 0005 — CSV format, amount handling and matching key

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

- **Matching key:** `allocation_id`, the same string stored on-chain as a right-padded `bytes32`. Beneficiary is
  *not* a key, because one beneficiary can hold several schedules.
- **Amounts:** human-readable decimals (`1250.5`) converted to raw units with the token's on-chain `decimals()` by a
  strict parser (`parseTokenAmount`). Unlike viem's `parseUnits`, it **rejects** extra precision instead of rounding.
  Exponents, signs and thousands separators are rejected. All comparisons use `bigint`.
- **Timestamps:** unix seconds (UTC). The create form also takes its start time in UTC. This was added after a
  reconciliation report showed a 6-hour `schedule_mismatch` on a schedule created in a UTC+6 browser.
- **Duplicates:** every row sharing an `allocation_id` is reported as `duplicate_csv` and excluded from matching. Rows
  are never silently merged.
- **Stale index:** when the indexer is behind the head, rows that aren't found are `pending_indexing`, not
  `missing_onchain`. Every report stores and shows the chain ID, contract, token, indexed block and chain head.
- **Export:** CSV with metadata comment lines and exact raw integer amounts. Cells starting with `= + - @` are
  prefixed with `'` to block spreadsheet formula injection.
- **Retention:** only the filename and the computed report are saved, not the uploaded file.

Statuses: `matched`, `amount_mismatch`, `beneficiary_mismatch`, `schedule_mismatch`, `missing_onchain`,
`pending_indexing`, `unexpected_onchain`, `duplicate_csv`, `invalid_row`.
