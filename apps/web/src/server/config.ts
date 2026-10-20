import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, isAddress, type Address, type PublicClient } from "viem";
import { erc20Abi } from "@/lib/abi";
import { BLOCKED_MAINNET_CHAIN_IDS, getNetwork, type NetworkProfile } from "@/lib/chain";

// Server-only module: reads local files and env. Never import from client components.

export interface Deployment {
  chainId: number;
  registry: Address;
  token: Address;
  admin: Address;
  deployBlock: bigint;
}

export class ConfigError extends Error {}

/** The active network profile (`NETWORK` env, default `local`). Throws ConfigError for unknown names. */
export function networkProfile(): NetworkProfile {
  try {
    return getNetwork(process.env.NETWORK || "local");
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
}

export function manifestPath(profile = networkProfile()): string {
  return (
    process.env.DEPLOYMENT_MANIFEST ??
    resolve(process.cwd(), `../../contracts/deployments/${profile.chain.id}.json`)
  );
}

/**
 * Load and validate the deployment manifest written by the deploy script. Fails closed: the
 * manifest's chain must be the active profile's chain, and mainnets are always refused.
 */
export function loadDeployment(path?: string, profile = networkProfile()): Deployment {
  const file = path ?? manifestPath(profile);
  let raw: unknown;
  try {
    // Runtime-only file: do not let the bundler trace it.
    raw = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
  } catch {
    throw new ConfigError(`Deployment manifest not found at ${file}. Deploy the contracts for ${profile.label} first.`);
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.chainId === "number" && BLOCKED_MAINNET_CHAIN_IDS.has(m.chainId)) {
    throw new ConfigError(`Manifest is for mainnet chain ${m.chainId}; TokenFlow only runs on local and test networks.`);
  }
  if (m.chainId !== profile.chain.id) {
    throw new ConfigError(
      `Manifest chainId ${String(m.chainId)} does not match NETWORK=${profile.name} (chain ${profile.chain.id}).`,
    );
  }
  for (const field of ["registry", "token", "admin"]) {
    if (typeof m[field] !== "string" || !isAddress(m[field] as string)) {
      throw new ConfigError(`Manifest field "${field}" is not a valid address`);
    }
  }
  return {
    chainId: profile.chain.id,
    registry: getAddress(m.registry as string),
    token: getAddress(m.token as string),
    admin: getAddress(m.admin as string),
    deployBlock: BigInt((m.deployBlock as number | undefined) ?? 0),
  };
}

/** Server-side RPC. On public networks this usually contains a provider API key: never send it to the browser. */
export function rpcUrl(profile = networkProfile()): string {
  const url = process.env.RPC_URL;
  if (url) return url;
  if (profile.kind === "local") return "http://127.0.0.1:8545";
  throw new ConfigError(`RPC_URL is required for NETWORK=${profile.name}`);
}

/**
 * RPC URL handed to the browser. Locally it defaults to RPC_URL; on public networks it defaults to the
 * chain's public endpoint and never falls back to RPC_URL, which may hold a secret key.
 */
export function publicRpcUrl(profile = networkProfile()): string {
  if (process.env.PUBLIC_RPC_URL) return process.env.PUBLIC_RPC_URL;
  return profile.kind === "local" ? rpcUrl(profile) : profile.chain.rpcUrls.default.http[0];
}

/** Blocks to wait before indexing (`INDEXER_CONFIRMATIONS` overrides the profile default). */
export function confirmations(profile = networkProfile()): bigint {
  const raw = process.env.INDEXER_CONFIRMATIONS;
  if (raw === undefined || raw === "") return BigInt(profile.confirmations);
  if (!/^\d+$/.test(raw)) throw new ConfigError("INDEXER_CONFIRMATIONS must be a non-negative integer");
  return BigInt(raw);
}

/** Saving reports needs a role-holder's signature everywhere except the local profile. */
export function reportSignatureRequired(profile = networkProfile()): boolean {
  return profile.kind !== "local" || process.env.REQUIRE_REPORT_SIGNATURE === "1";
}

/**
 * Validate the environment for the active profile and return a list of problems (empty when OK).
 * Startup code (indexer, health route) refuses to run with problems on public networks.
 */
export function validateEnv(): string[] {
  const problems: string[] = [];
  let profile: NetworkProfile;
  try {
    profile = networkProfile();
  } catch (err) {
    return [(err as Error).message];
  }
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  if (profile.kind !== "local") {
    if (!process.env.RPC_URL) problems.push(`RPC_URL is required for NETWORK=${profile.name}`);
    if (process.env.PUBLIC_RPC_URL && process.env.PUBLIC_RPC_URL === process.env.RPC_URL) {
      problems.push("PUBLIC_RPC_URL must not equal RPC_URL on public networks (RPC_URL may contain an API key)");
    }
  }
  try {
    confirmations(profile);
  } catch (err) {
    problems.push((err as Error).message);
  }
  return problems;
}

let client: PublicClient | undefined;
export function getPublicClient(): PublicClient {
  const profile = networkProfile();
  client ??= createPublicClient({
    chain: profile.chain,
    transport: http(rpcUrl(profile), { retryCount: 1, timeout: profile.kind === "local" ? 5_000 : 15_000 }),
  });
  return client;
}

/** Verify the RPC really serves the configured chain before trusting anything it returns. */
export async function assertConfiguredChain(
  c: Pick<PublicClient, "getChainId"> = getPublicClient(),
  profile = networkProfile(),
): Promise<void> {
  const id = await c.getChainId();
  if (id !== profile.chain.id) {
    throw new ConfigError(`RPC reports chain ${id}, but NETWORK=${profile.name} expects ${profile.chain.id}.`);
  }
}

/** Latest block minus the confirmation depth: the newest block the indexer and reports may rely on. */
export async function getSafeHeadBlock(c: Pick<PublicClient, "getBlockNumber"> = getPublicClient()): Promise<bigint> {
  const latest = await c.getBlockNumber({ cacheTime: 0 });
  const depth = confirmations();
  return latest > depth ? latest - depth : 0n;
}

const decimalsCache = new Map<string, number>();
export async function getTokenDecimals(token: Address, c: PublicClient = getPublicClient()): Promise<number> {
  const cached = decimalsCache.get(token);
  if (cached !== undefined) return cached;
  const decimals = await c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
  decimalsCache.set(token, decimals);
  return decimals;
}
