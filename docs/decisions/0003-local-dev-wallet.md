# ADR 0003 — Local wallet strategy: Anvil dev-account connector + injected wallet

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The demo must work without a real wallet or funds, must never put a private key in the browser bundle, and must
not present simulated transactions as real ones (plan section 6).

## Decision

The app offers two wagmi connectors, and both are limited to chain `31337`:

1. **Anvil dev accounts (#0–#2).** These wrap wagmi's `mock` connector. Transactions go out as `eth_sendTransaction`
   to Anvil, which signs with its own **unlocked** default accounts. They are real transactions on the local chain.
   The browser never sees a private key. Each connector gets a stable id (`anvil-dev-N`) so server and client
   rendering agree, and the chosen account is remembered in `localStorage` until you disconnect.
2. **Injected browser wallet**, for example MetaMask in a development-only profile, pointed at
   `http://127.0.0.1:8545`.

Deployment and seed scripts also use Anvil's unlocked accounts (`forge script --unlocked --sender ...`), so no key
appears in `package.json` or anywhere else in the repository.

## Consequences

- The dev-account connector only works against a node with unlocked accounts, which means Anvil.
  Against any other RPC it fails, which is the desired fail-closed behaviour.
- The UI shows a permanent "LOCAL DEVELOPMENT ONLY" banner and refuses writes on any other chain. On testnet
  profiles the dev accounts are not offered at all ([ADR 0006](0006-network-profiles.md)).
