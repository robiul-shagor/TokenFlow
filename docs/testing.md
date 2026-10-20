# Testing report

Results below are from actual runs on 2026-10-20 (macOS arm64, Node 22.23, pnpm 12.10, Foundry/forge 1.8.5,
solc 0.8.28, OpenZeppelin Contracts 5.7.0, PostgreSQL 16.15). CI runs the same commands on every push and PR.

## Commands

```bash
pnpm contracts:test                      # forge test: unit + fuzz + invariant
cd contracts && forge coverage --no-match-coverage "(test|script)/"
pnpm test                                # vitest: unit, component, and Anvil + Postgres integration
pnpm lint && pnpm typecheck && pnpm build
```

Integration tests start their own Anvil on port 8546 and use `TEST_DATABASE_URL`
(default `postgres://localhost:5432/tokenflow_test`). They are skipped if Anvil or `contracts/out` is missing,
except in CI, where `REQUIRE_INTEGRATION=1` turns a skip into a failure.

## Contracts: 24 tests, all passing

```
Suite result: ok. 23 passed; 0 failed; 0 skipped     (VestingRegistryTest: 21 unit + 2 fuzz)
[PASS] testFuzz_releaseNeverExceedsVested(...)   (runs: 1000)
[PASS] testFuzz_vestedIsMonotonicAndBounded(...) (runs: 1000)
Suite result: ok. 1 passed; 0 failed; 0 skipped      (VestingRegistryInvariantTest)
[PASS] invariant_noForeignRelease
[PASS] invariant_releaseAccounting
[PASS] invariant_releasedNeverExceedsVested
[PASS] invariant_solvent
  (256 runs × depth 64 = 16,384 random create/release/warp calls)
Ran 2 test suites: 24 tests passed, 0 failed, 0 skipped
```

Coverage (`forge coverage`, excluding tests and scripts):

| File | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| `src/VestingRegistry.sol` | 100% (50/50) | 100% (67/67) | 100% (14/14) | 100% (10/10) |
| `src/mocks/MockERC20.sol` | 100% (3/3) | 100% (1/1) | n/a | 100% (2/2) |

What is covered: role-gated creation (unauthorised, granted manager), every input revert (zero id, zero
beneficiary, zero amount, zero duration, cliff > duration, duplicate id), insufficient funding, fee-on-transfer
token, a token whose transfers return `false`, vesting at before start / start / just before cliff / exactly at
cliff / midpoint / just before end / end / far future, rounding down, repeated claims, zero-claim reverts,
beneficiary-only release, isolation between multiple schedules and beneficiaries, and the fuzzed and invariant
properties above.

## Web: 83 tests in 14 files, all passing

| Area | File | What it proves |
|---|---|---|
| Amount parsing | `lib/amounts.test.ts` | Exact decimal→raw conversion, rejects rounding/exponents/negatives, large values without precision loss |
| Allocation ids | `lib/allocationId.test.ts` | `bytes32` encoding matches Solidity `bytes32("team-001")` |
| CSV validation | `lib/csv.test.ts` | Missing columns, empty file, invalid address/checksum/amount/cliff/duration/token, duplicates, BOM, blank lines, size limit |
| Reconciliation | `lib/reconcile.test.ts` | All-match, missing, unexpected, amount/beneficiary/schedule mismatch, duplicates, stale → `pending_indexing`, big integers, CSV export + formula-injection escaping |
| Tx states | `lib/txState.test.ts` | State machine; wallet rejection vs revert classification; custom errors mapped to messages |
| Create form | `lib/createForm.test.ts` | Exact contract args, UTC start, field errors |
| Indexer health | `indexer/health.test.ts` | synced / behind / stalled / error / RPC unavailable |
| ABI drift | `lib/abi.test.ts` | Hand-written ABI matches the compiled Foundry artifact |
| Wallet states | `components/WalletPanel.test.tsx` | Disconnected, wrong chain (+ switch), account/chain change during session, reconnecting |
| Tx UI | `components/TxStatusView.test.tsx` | Preparing, awaiting signature, pending, confirmed, rejected, failed |
| Claim | `components/ClaimButton.test.tsx` | Disabled when nothing claimable or not beneficiary; calls `release` otherwise |
| Report UI | `components/ReconciliationResult.test.tsx` | Chain/contract/block context, stale warning, problem filter |
| **Integration** | `test/integration/flow.test.ts` | Real Anvil + Postgres: issuer → vesting → claim → index → reconcile → export; another account cannot claim; stale report → `pending_indexing` then `matched` after indexing; **replay with zero duplicates**; **failed batch leaves no partial writes and succeeds on retry**; catch-up in 1-block batches after restart; chain-reset detection and `--reset` rebuild |

## Static analysis

- `forge lint`: 0 findings. Two warnings were suppressed inline with reasons: the `uint64(block.timestamp)` casts,
  and the deliberate strict balance-delta equality.
- **Slither 0.11.6** (`slither src/VestingRegistry.sol --filter-paths lib/`), 3 results, all reviewed:
  - `incorrect-equality` on `amount == 0` in `release`. This is intended: it reverts when nothing is releasable.
    The value is computed from contract state and can't be manipulated externally to bypass anything.
  - `timestamp` in `release` and `_vested`. Vesting is inherently time-based. Validator timestamp skew of a few
    seconds only shifts the linear amount by a few seconds' worth, and it can never exceed the allocation (fuzz +
    invariant tests).
- No formal verification was performed. **No independent audit.**

## Manual end-to-end check (browser, local Anvil)

Done with Playwright against `pnpm dev`. Screenshots are in [images/](images/):

1. Overview shows the seeded allocations, live claimable amounts, the unlock chart and "In sync".
2. Anvil #1 claimed `seed-001` (500 TFT). The status went pending → confirmed (block 9), the indexer picked it up,
   the row became "Completed" and Claim was disabled with "Nothing claimable yet".
3. Anvil #0 created `ops-001` and `ops-003`. The default allowance path skipped `approve`.
4. Uploading `allocations.with-issues.csv` produced: 1 matched, 1 amount mismatch, 1 beneficiary mismatch, 1 schedule
   mismatch, 2 duplicates, 2 invalid rows, 1 on-chain-only. The export contains chain, contract and indexed block.
5. From a report's prefill link, Anvil #0 created `ops-010` (12.5 TFT, 90-day cliff). The stepper went
   Approve (not needed) → Create (confirmed, block 12) → Indexed.
6. Overview, Create allocation, My allocations and the report were checked at 1440px and 390px with no console
   errors.

## Known gaps

- No Playwright suite is committed. The browser flow above was run manually with Playwright tooling.
- No load or performance testing, and indexing lag has not been measured beyond the 2-second poll interval.
