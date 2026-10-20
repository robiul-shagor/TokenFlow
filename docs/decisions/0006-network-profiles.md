# ADR 0006: Network profiles (local and testnets, no mainnet)

**Status:** accepted

## Context

The MVP was hard-wired to Anvil (`31337`). To use it as a live showcase, the same code has to run against a public
network, without weakening the fail-closed rules or ever pointing an unaudited contract at real funds.

## Decision

- One `NETWORK` env var selects a profile from `apps/web/src/lib/chain.ts`: `local`, `sepolia` or `base-sepolia`.
  Each profile fixes the chain, the explorer, the default confirmation depth and whether the Anvil dev accounts exist.
- **Fail closed, per profile.** The manifest's `chainId`, the RPC's reported chain and the wallet's chain must all
  equal the profile's chain. Unknown profile names throw rather than fall back.
- **No mainnet.** There is no mainnet profile. Mainnet chain IDs are on an explicit block list in the app, and the
  deploy script only accepts 31337, 11155111 and 84532 (covered by Forge tests).
- **Secrets stay server-side.** `RPC_URL` (which may contain a provider key) is used only on the server. The browser
  gets `PUBLIC_RPC_URL` or the chain's public endpoint, never `RPC_URL`. Deploys use an encrypted Foundry keystore or
  a Ledger, never a plaintext private key.
- **Reorg safety by confirmation depth.** The indexer reads up to `latest − confirmations`. The existing block-hash
  cursor check turns a deeper reorg into a hard stop.
- **Report writes are authorised by the chain.** On public networks, saving a report needs a signature from an
  account that holds `SCHEDULE_MANAGER_ROLE`, verified with viem (EOA, ERC-1271 or ERC-6492) and checked on-chain.
  This needs no accounts, passwords or new dependencies.

## Consequences

- The same build runs locally and on a testnet. Only environment variables differ.
- Hosting stays a plain Node server plus the indexer worker. The rate limiter and replay cache are in-memory, so
  scaling past one instance needs shared storage.
- A mainnet launch would at least need an independent audit, a Safe (ideally with a timelock) as admin, a real
  token, monitoring, a strict CSP and a review of the residual risks in the [threat model](../threat-model.md).
  Adding a mainnet profile should be a deliberate change to this ADR, not a configuration switch.
