import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, isAddress, type Address, type PublicClient } from "viem";
import { erc20Abi } from "@/lib/abi";
import { LOCAL_CHAIN, LOCAL_CHAIN_ID } from "@/lib/chain";

// Server-only module: reads local files and env. Never import from client components.

export interface Deployment {
  chainId: typeof LOCAL_CHAIN_ID;
  registry: Address;
  token: Address;
  admin: Address;
  deployBlock: bigint;
}

export class ConfigError extends Error {}

export function manifestPath(): string {
  return process.env.DEPLOYMENT_MANIFEST ?? resolve(process.cwd(), "../../contracts/deployments/31337.json");
}

/** Load and validate the local-only deployment manifest written by `pnpm contracts:deploy`. Fails closed. */
export function loadDeployment(path = manifestPath()): Deployment {
  let raw: unknown;
  try {
    // Runtime-only local file: do not let the bundler trace it.
    raw = JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8"));
  } catch {
    throw new ConfigError(`Deployment manifest not found at ${path}. Run \`pnpm contracts:deploy\` first.`);
  }
  const m = raw as Record<string, unknown>;
  if (m.chainId !== LOCAL_CHAIN_ID) {
    throw new ConfigError(`Unsupported chainId ${String(m.chainId)} in manifest; only ${LOCAL_CHAIN_ID} is allowed.`);
  }
  for (const field of ["registry", "token", "admin"]) {
    if (typeof m[field] !== "string" || !isAddress(m[field] as string)) {
      throw new ConfigError(`Manifest field "${field}" is not a valid address`);
    }
  }
  return {
    chainId: LOCAL_CHAIN_ID,
    registry: getAddress(m.registry as string),
    token: getAddress(m.token as string),
    admin: getAddress(m.admin as string),
    deployBlock: BigInt((m.deployBlock as number | undefined) ?? 0),
  };
}

export function rpcUrl(): string {
  return process.env.RPC_URL ?? "http://127.0.0.1:8545";
}

/** RPC URL handed to the browser. Local-only by default. */
export function publicRpcUrl(): string {
  return process.env.PUBLIC_RPC_URL ?? rpcUrl();
}

let client: PublicClient | undefined;
export function getPublicClient(): PublicClient {
  client ??= createPublicClient({ chain: LOCAL_CHAIN, transport: http(rpcUrl(), { retryCount: 1, timeout: 5_000 }) });
  return client;
}

/** Verify the RPC really is the local chain before trusting anything it returns. */
export async function assertLocalChain(c: Pick<PublicClient, "getChainId"> = getPublicClient()): Promise<void> {
  const id = await c.getChainId();
  if (id !== LOCAL_CHAIN_ID) throw new ConfigError(`RPC reports chain ${id}; only ${LOCAL_CHAIN_ID} is supported.`);
}

const decimalsCache = new Map<string, number>();
export async function getTokenDecimals(token: Address, c: PublicClient = getPublicClient()): Promise<number> {
  const cached = decimalsCache.get(token);
  if (cached !== undefined) return cached;
  const decimals = await c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
  decimalsCache.set(token, decimals);
  return decimals;
}
