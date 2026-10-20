# Deploying to a testnet

TokenFlow runs against one **network profile**, chosen with `NETWORK`:

| Profile | Chain | Wallets | Indexer confirmations | Saving reports |
|---|---|---|---|---|
| `local` (default) | Anvil `31337` | Anvil dev accounts + browser wallet | 0 | open |
| `sepolia` | Sepolia `11155111` | browser wallet | 3 | schedule-manager signature |
| `base-sepolia` | Base Sepolia `84532` | browser wallet | 3 | schedule-manager signature |

There is **no mainnet profile**. The contracts are unaudited and the token is a freely mintable test token. The app
and the deploy script refuse mainnet chain IDs (see [ADR 0006](decisions/0006-network-profiles.md) for what a
mainnet launch would need).

## 1. Deployer key (encrypted keystore, never plaintext)

Use a **fresh, test-only account**. Never reuse a wallet that holds real funds.

```bash
cast wallet new                                          # prints a new throwaway key pair
cast wallet import tokenflow-deployer --interactive      # paste the key; it is stored encrypted under ~/.foundry/keystores
cast wallet address --account tokenflow-deployer         # fund this address from a testnet faucet
```

No `PRIVATE_KEY` environment variable is used anywhere. A hardware wallet works too: replace `--account …` with
`--ledger` in the deploy command.

## 2. Deploy and verify the contracts

```bash
export SEPOLIA_RPC_URL="https://…"        # your RPC provider URL (keep it out of git)
export ETHERSCAN_API_KEY="…"              # Etherscan API v2 key: verifies on Sepolia and Base Sepolia
pnpm contracts:deploy:sepolia             # or: BASE_SEPOLIA_RPC_URL=… pnpm contracts:deploy:base-sepolia
```

The script deploys `MockERC20` (anyone can mint it; it doubles as the faucet), deploys `VestingRegistry`, verifies
both on the explorer, and writes `contracts/deployments/11155111.json`. Unlike the local manifest, testnet manifests
contain only public addresses, so you can commit them.

Optional:

- `TOKEN_ADDRESS=0x…`: use an existing ERC-20 instead of deploying the mock token. Fee-on-transfer tokens are rejected.
- `ADMIN_ADDRESS=0x…`: make another account (for example a Safe) the registry admin and schedule manager. The
  deployer then has no role.
- `DEPLOYER_ACCOUNT=name`: keystore name if it isn't `tokenflow-deployer`.

## 3. Configure and run the app

`apps/web/.env.local` (or your host's environment):

```bash
NETWORK=sepolia
DATABASE_URL=postgres://…                # any PostgreSQL 16 database
RPC_URL=https://…                        # server-side; may contain an API key
# PUBLIC_RPC_URL=https://…               # optional browser RPC; must differ from RPC_URL
```

```bash
pnpm db:migrate
pnpm build
pnpm --filter web start                  # Next.js production server (put it behind HTTPS)
pnpm indexer                             # long-running worker; run it under a process manager
curl https://your-host/api/health        # names any missing settings; never echoes values
```

Startup refuses to run if the manifest, the RPC and `NETWORK` disagree on the chain, if `RPC_URL` is missing, or if
`PUBLIC_RPC_URL` equals `RPC_URL`.

## What changes on a public network

- **Wallets:** the Anvil dev accounts disappear; visitors connect their own browser wallet, and the app asks them to
  switch to the configured chain.
- **Reorg safety:** the indexer only reads blocks at least `INDEXER_CONFIRMATIONS` deep (default 3), and reports are
  pinned to that confirmed head. A reorg deeper than that stops the indexer with a clear error instead of silently
  keeping orphaned events (`pnpm indexer --reset` rebuilds from the chain).
- **Saving reports:** anyone can validate a CSV. Saving a report needs an EIP-191 signature, from an account that
  holds `SCHEDULE_MANAGER_ROLE`, over the chain, the registry, the CSV's SHA-256 and a timestamp. The server checks
  the signature (EOAs and smart-contract wallets such as a Safe), checks the role on-chain, and rejects expired or
  replayed signatures.
- **Abuse limits:** per-IP rate limits on CSV validation (30/min) and report creation (10/min). They live in memory,
  so they assume a single app instance behind a proxy that sets `X-Forwarded-For`.
- **Headers:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS,
  and no `X-Powered-By`.
- **Explorer links:** transaction hashes and addresses link to Etherscan / Basescan.

## Known follow-ups before calling it production

- A strict Content-Security-Policy with per-request nonces.
- Shared rate-limit storage (Redis or similar) for more than one app instance.
- Recording who saved each report (the signer address) in the database.
- Moving the admin role to a Safe, and monitoring and alerting for the indexer.
- An independent audit before any mainnet use.
