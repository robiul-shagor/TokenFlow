import { describe, expect, it } from "vitest";
import { BLOCKED_MAINNET_CHAIN_IDS, explorerLink, getNetwork, NETWORKS, networkForChainId } from "./chain";

describe("network profiles", () => {
  it("defaults to local and resolves known testnets", () => {
    expect(getNetwork().chain.id).toBe(31337);
    expect(getNetwork("sepolia").chain.id).toBe(11155111);
    expect(getNetwork("base-sepolia").chain.id).toBe(84532);
  });

  it("rejects unknown names instead of falling back", () => {
    expect(() => getNetwork("mainnet")).toThrow(/Unknown NETWORK/);
    expect(() => getNetwork("toString")).toThrow(/Unknown NETWORK/);
  });

  it("has no profile on a mainnet chain", () => {
    for (const n of Object.values(NETWORKS)) expect(BLOCKED_MAINNET_CHAIN_IDS.has(n.chain.id)).toBe(false);
    expect(BLOCKED_MAINNET_CHAIN_IDS.has(1)).toBe(true);
    expect(BLOCKED_MAINNET_CHAIN_IDS.has(8453)).toBe(true);
  });

  it("waits for confirmations on testnets only", () => {
    expect(NETWORKS.local.confirmations).toBe(0);
    expect(NETWORKS.sepolia.confirmations).toBeGreaterThan(0);
  });

  it("builds explorer links only where an explorer exists", () => {
    expect(explorerLink(null, "tx", "0xabc")).toBeNull();
    expect(explorerLink(NETWORKS.sepolia.explorerUrl, "address", "0xabc")).toBe("https://sepolia.etherscan.io/address/0xabc");
    expect(networkForChainId(84532)?.name).toBe("base-sepolia");
    expect(networkForChainId(1)).toBeNull();
  });
});
