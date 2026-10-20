import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNetwork } from "@/lib/chain";
import {
  assertConfiguredChain,
  ConfigError,
  confirmations,
  getSafeHeadBlock,
  loadDeployment,
  networkProfile,
  publicRpcUrl,
  reportSignatureRequired,
  rpcUrl,
  validateEnv,
} from "./config";

const ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function manifest(chainId: number): string {
  const dir = mkdtempSync(join(tmpdir(), "tf-manifest-"));
  const file = join(dir, `${chainId}.json`);
  writeFileSync(file, JSON.stringify({ chainId, token: ADDR, registry: ADDR, admin: ADDR, deployBlock: 7 }));
  return file;
}

afterEach(() => vi.unstubAllEnvs());

describe("network config", () => {
  it("uses the local profile by default and fails on unknown names", () => {
    vi.stubEnv("NETWORK", "");
    expect(networkProfile().name).toBe("local");
    vi.stubEnv("NETWORK", "mainnet");
    expect(() => networkProfile()).toThrow(ConfigError);
  });

  it("only accepts a manifest for the active network's chain", () => {
    const sepolia = getNetwork("sepolia");
    expect(loadDeployment(manifest(11155111), sepolia).chainId).toBe(11155111);
    expect(() => loadDeployment(manifest(31337), sepolia)).toThrow(/does not match NETWORK=sepolia/);
    expect(() => loadDeployment(manifest(1), sepolia)).toThrow(/mainnet/);
  });

  it("requires RPC_URL on testnets and never hands it to the browser", () => {
    const sepolia = getNetwork("sepolia");
    vi.stubEnv("RPC_URL", "");
    expect(() => rpcUrl(sepolia)).toThrow(/RPC_URL is required/);
    vi.stubEnv("RPC_URL", "https://rpc.example/v2/SECRET-KEY");
    vi.stubEnv("PUBLIC_RPC_URL", "");
    expect(publicRpcUrl(sepolia)).not.toContain("SECRET-KEY");
    expect(publicRpcUrl(sepolia)).toBe(sepolia.chain.rpcUrls.default.http[0]);
    // Locally the browser may share the server's RPC.
    vi.stubEnv("RPC_URL", "http://127.0.0.1:8545");
    expect(publicRpcUrl(getNetwork("local"))).toBe("http://127.0.0.1:8545");
  });

  it("validates the environment per profile without echoing values", () => {
    vi.stubEnv("NETWORK", "sepolia");
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("RPC_URL", "https://rpc.example/SECRET");
    vi.stubEnv("PUBLIC_RPC_URL", "https://rpc.example/SECRET");
    vi.stubEnv("INDEXER_CONFIRMATIONS", "");
    const problems = validateEnv();
    expect(problems).toEqual(["PUBLIC_RPC_URL must not equal RPC_URL on public networks (RPC_URL may contain an API key)"]);
    expect(problems.join(" ")).not.toContain("SECRET");
    vi.stubEnv("NETWORK", "local");
    vi.stubEnv("PUBLIC_RPC_URL", "");
    expect(validateEnv()).toEqual([]);
  });

  it("requires report signatures on public networks", () => {
    expect(reportSignatureRequired(getNetwork("sepolia"))).toBe(true);
    vi.stubEnv("REQUIRE_REPORT_SIGNATURE", "");
    expect(reportSignatureRequired(getNetwork("local"))).toBe(false);
    vi.stubEnv("REQUIRE_REPORT_SIGNATURE", "1");
    expect(reportSignatureRequired(getNetwork("local"))).toBe(true);
  });

  it("subtracts the confirmation depth from the head", async () => {
    vi.stubEnv("NETWORK", "sepolia");
    vi.stubEnv("INDEXER_CONFIRMATIONS", "");
    expect(confirmations()).toBe(3n);
    const client = { getBlockNumber: async () => 100n };
    expect(await getSafeHeadBlock(client)).toBe(97n);
    vi.stubEnv("INDEXER_CONFIRMATIONS", "200");
    expect(await getSafeHeadBlock(client)).toBe(0n);
    vi.stubEnv("INDEXER_CONFIRMATIONS", "-1");
    expect(() => confirmations()).toThrow(/non-negative integer/);
  });

  it("refuses an RPC that serves a different chain", async () => {
    await expect(assertConfiguredChain({ getChainId: async () => 1 }, getNetwork("sepolia"))).rejects.toThrow(
      /expects 11155111/,
    );
    await expect(assertConfiguredChain({ getChainId: async () => 11155111 }, getNetwork("sepolia"))).resolves.toBeUndefined();
  });
});
