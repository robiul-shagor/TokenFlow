import { anvil, baseSepolia, sepolia, type Chain } from "viem/chains";

/**
 * Network profiles. The app runs against exactly one profile, chosen by the `NETWORK` env var
 * (default `local`), and rejects every other chain ID (fail closed).
 *
 * There is deliberately no mainnet profile: the contracts are unaudited and test-token only.
 * Mainnet chain IDs are also refused explicitly, so a hand-edited manifest or RPC can't sneak one in.
 */
export type NetworkName = "local" | "sepolia" | "base-sepolia";

export interface NetworkProfile {
  name: NetworkName;
  chain: Chain;
  kind: "local" | "testnet";
  /** Short label for banners and badges. */
  label: string;
  /** Block explorer base URL, or null when there is none (local Anvil). */
  explorerUrl: string | null;
  /** Blocks to wait before indexing, so short reorgs never reach the read model. */
  confirmations: number;
}

export const NETWORKS: Record<NetworkName, NetworkProfile> = {
  local: { name: "local", chain: anvil, kind: "local", label: "Anvil (local)", explorerUrl: null, confirmations: 0 },
  sepolia: {
    name: "sepolia",
    chain: sepolia,
    kind: "testnet",
    label: "Sepolia testnet",
    explorerUrl: "https://sepolia.etherscan.io",
    confirmations: 3,
  },
  "base-sepolia": {
    name: "base-sepolia",
    chain: baseSepolia,
    kind: "testnet",
    label: "Base Sepolia testnet",
    explorerUrl: "https://sepolia.basescan.org",
    confirmations: 3,
  },
};

/** Mainnets of common EVM chains. Never accepted, whatever the configuration says. */
export const BLOCKED_MAINNET_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, 10, 56, 100, 137, 250, 324, 1101, 5000, 8453, 42161, 42220, 43114, 59144, 81457, 534352,
]);

export function isNetworkName(value: string): value is NetworkName {
  return Object.hasOwn(NETWORKS, value);
}

/** Resolve a profile by name. Unknown names throw rather than falling back to something else. */
export function getNetwork(name: string | undefined = "local"): NetworkProfile {
  if (!isNetworkName(name)) {
    throw new Error(`Unknown NETWORK "${name}". Use one of: ${Object.keys(NETWORKS).join(", ")}.`);
  }
  const profile = NETWORKS[name];
  if (BLOCKED_MAINNET_CHAIN_IDS.has(profile.chain.id)) throw new Error(`Mainnet chain ${profile.chain.id} is not supported`);
  return profile;
}

/** Profile for a chain ID, if it is one this app knows (used to label stored reports). */
export function networkForChainId(chainId: number): NetworkProfile | null {
  return Object.values(NETWORKS).find((n) => n.chain.id === chainId) ?? null;
}

export function explorerLink(explorerUrl: string | null, kind: "tx" | "address", value: string): string | null {
  return explorerUrl ? `${explorerUrl}/${kind}/${value}` : null;
}

// Kept for the local-only code paths and tests (seed data, integration harness).
export const LOCAL_CHAIN = anvil;
export const LOCAL_CHAIN_ID = 31337 as const;
