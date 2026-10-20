# Requirements and acceptance criteria

Derived from the original project plan. All of it is local-only (Anvil chain 31337, test tokens).

## User stories

**Issuer (Anvil #0)**
- As an issuer, I can create a vesting allocation (id, beneficiary, amount, UTC start, cliff, duration) and fund it in
  the same flow.
  - *AC:* Invalid input is rejected client-side and by the contract. A non-manager account is warned and the contract
    reverts. Approve happens only when the allowance is short, for the exact amount. Every transaction shows
    preparing → awaiting confirmation → pending → confirmed / failed / rejected.
- As an issuer, I can see the number of allocations, totals allocated and claimed, live claimable, and the last
  indexed block.

**Beneficiary (Anvil #1, #2)**
- As a beneficiary, I can see my schedules and claim what has vested.
  - *AC:* Claim is enabled only for the beneficiary when `releasable > 0`. The amount comes from the contract.
    Claiming twice in a row fails with "Nothing is claimable yet".

**Operator**
- As an operator, I can upload a CSV, see validation errors per line, run a reconciliation and export the result.
  - *AC:* The report shows chain ID, registry, token, indexed block, head block and a stale warning. Every row gets a
    status and an explanation. Export keeps exact raw amounts.

**Any user**
- Loading, empty, error, wallet-disconnected and wrong-network states are all shown. Writes are disabled on any chain
  other than 31337.

## Non-functional
- A fresh clone runs with the documented commands, and no secret is needed.
- No floating-point arithmetic for token amounts.
- The indexer is idempotent and restartable. Stale indexing is visible.
- CI needs no funded wallet, private key, mainnet RPC or faucet.
