# ADR 0001 — Custom `VestingRegistry` instead of OpenZeppelin `VestingWallet`

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The plan asks us to review OpenZeppelin's `VestingWallet` (v5.7.0) before writing custom vesting logic.
Relevant behaviour of `VestingWallet` / `VestingWalletCliff`:

1. **One contract per beneficiary.** Each schedule is a separate deployed wallet; the beneficiary is its `Ownable` owner.
2. **Allocation is not fixed.** `vestedAmount(token, t)` uses `balanceOf(this) + released(token)`, so anyone can top
   up a wallet and the "total allocation" changes. There is no on-chain record of the *intended* amount.
3. **No external identifier.** Nothing links a wallet to an off-chain allocation row.
4. **Ownership is transferable**, so the beneficiary of a schedule can change after creation.
5. **Anyone can call `release`**; funds always go to the owner.

TokenFlow's core feature is reconciling a CSV of *expected* allocations against on-chain schedules. That needs a
stable identifier per allocation, a fixed total amount, a fixed beneficiary and a single event stream to index.

## Decision

Write a small `VestingRegistry` that holds many schedules for **one ERC-20 token**:

- Schedules are keyed by an operator-chosen `bytes32 allocationId` (short ASCII ids such as `team-001`).
- `createSchedule` is restricted to `SCHEDULE_MANAGER_ROLE` (OpenZeppelin `AccessControl`) and **funds the
  schedule atomically** via `SafeERC20.safeTransferFrom`. There are no unfunded schedules.
- The balance delta is checked, so fee-on-transfer and similar tokens revert with `UnsupportedToken`.
- The vesting curve copies OpenZeppelin's linear formula (`total * (t - start) / duration`, rounded down). It adds a
  cliff: nothing vests before `start + cliffDuration`, and from then on the linear amount applies.
- Only the beneficiary can `release`. Beneficiaries are immutable, and there is no revocation.
- `ReentrancyGuard` and checks-effects-interactions protect both state-changing functions.
- Events: `ScheduleCreated`, `ScheduleFunded`, `TokensReleased`, all with the indexed `allocationId`.

Boundary behaviour (tested in `test_vested_boundaries`):

| Time | Vested |
|---|---|
| `t < start + cliff` | 0 |
| `t == start + cliff` | `total * cliff / duration` |
| `start + cliff <= t < start + duration` | `total * (t - start) / duration` (floor) |
| `t >= start + duration` | `total` |

With `cliff == 0`, vesting at `t == start` is 0 and accrues linearly afterwards.

## Consequences

- More custom surface than reusing `VestingWallet`. It is mitigated by keeping the contract around 150 lines, reusing
  OpenZeppelin primitives, and testing it with unit, fuzz and invariant tests (100% line and branch coverage).
- One registry per token. Multi-token support would mean deploying another registry.
- No revocation and no beneficiary changes. Both are out of scope for the MVP (see plan section 2).
- Not audited.
