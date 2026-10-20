# Threat model (initial)

**Scope:** a local-only portfolio prototype on Anvil (`31337`) with test tokens that have no monetary value. It is
not audited and not production software. This document lists the assumptions, the trust boundaries and the risks we
know about.

## Assets

- Correct vesting accounting: released ≤ vested ≤ allocated, and the registry stays solvent.
- Integrity of the indexed read model and of reconciliation reports, which operators may act on.
- Developer machines: no real keys or secrets should ever be needed or committed.

## Trust boundaries

| Boundary | Trust | Controls |
|---|---|---|
| Browser → contract | Untrusted caller | `AccessControl` on `createSchedule`; only the beneficiary can `release`; all input validated on-chain. Hiding a button is not access control. |
| Browser → API | Untrusted input | Size limits (1 MB CSV), strict parsing, chain and contract checked against the configured deployment, generic error messages |
| RPC → indexer | Trusted local node | Chain ID asserted at startup; block-hash check on the cursor detects chain resets |
| CSV file | Untrusted | Validated row by row; duplicates surfaced; exact integer conversion; formula-injection-safe export |
| Deployment manifest | Local, generated | `chainId` must be 31337 and addresses must be valid, or the app refuses to start (fail closed) |

## STRIDE summary

| Threat | Example | Mitigation | Residual risk |
|---|---|---|---|
| **S**poofing | Someone claims another person's allocation | `msg.sender == beneficiary` check; invariant test `invariant_noForeignRelease` | None known |
| **T**ampering | Fee-on-transfer token under-funds a schedule | Balance-delta check reverts `UnsupportedToken` | Rebasing tokens can still change balances after funding. Only the bundled mock token is supported. |
| **T**ampering | Re-entrancy via a malicious token | `nonReentrant` + checks-effects-interactions | Not audited |
| **T**ampering | Replayed or duplicated events inflate `released` | Unique event key; projection only on insert; one transaction per batch | Reorgs are not handled (Anvil only) |
| **R**epudiation | "The report said X" | Reports persist the chain, contract, indexed block, head block and stale flag | No signing of reports |
| **I**nformation disclosure | Keys leak through the bundle, logs or screenshots | No keys exist: unlocked Anvil accounts are used; `.env*` is git-ignored; gitleaks runs in CI | The developer could still paste a real key into a browser wallet. The README warns against it. |
| **D**enial of service | Huge CSV | 1 MB / 10,000-row limits | Local single-operator app with no rate limiting |
| **E**levation of privilege | Non-manager creates schedules | `SCHEDULE_MANAGER_ROLE`; tested; UI warns, but the contract enforces | `DEFAULT_ADMIN_ROLE` is a single EOA, with no multisig or timelock |

## Out of scope / known limitations

- Mainnet and public testnets. Public chains would need reorg handling, confirmation depths, authentication and a
  real key-management story.
- Authentication on the API. It is a local single-operator tool, so anyone who can reach the dev server can create
  reports.
- Independent security review. Slither findings are reviewed in [testing.md](testing.md).
