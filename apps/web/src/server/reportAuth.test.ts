import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildReportAuthMessage, sha256Hex } from "@/lib/reportAuth";
import type { Deployment } from "./config";
import { resetUsedReportSignatures, verifyReportAuth } from "./reportAuth";

// A throwaway key generated per test run; nothing is stored or reused.
const signer = privateKeyToAccount(generatePrivateKey());
const deployment: Deployment = {
  chainId: 11155111,
  registry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  token: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  admin: signer.address,
  deployBlock: 1n,
};
const CSV = "allocation_id,beneficiary\nteam-1,0x0\n";
const NOW = Date.parse("2026-10-20T10:00:00Z");

function client(isManager = true) {
  return {
    verifyMessage: (args: Parameters<typeof verifyMessage>[0]) => verifyMessage(args),
    readContract: vi.fn(async () => isManager),
  } as never;
}

async function signed(overrides: { csv?: string; chainId?: number; issuedAt?: string } = {}) {
  const issuedAt = overrides.issuedAt ?? new Date(NOW).toISOString();
  const message = buildReportAuthMessage({
    chainId: overrides.chainId ?? deployment.chainId,
    registry: deployment.registry,
    csvSha256: await sha256Hex(overrides.csv ?? CSV),
    issuedAt,
  });
  return { address: signer.address, issuedAt, signature: await signer.signMessage({ message }) };
}

beforeEach(() => resetUsedReportSignatures());

describe("verifyReportAuth", () => {
  it("accepts a fresh signature from a schedule manager, once", async () => {
    const auth = await signed();
    const ok = await verifyReportAuth({ auth, csv: CSV, deployment, client: client(), now: NOW });
    expect(ok).toEqual({ ok: true, address: signer.address });
    const replay = await verifyReportAuth({ auth, csv: CSV, deployment, client: client(), now: NOW });
    expect(replay).toMatchObject({ ok: false, status: 401, error: expect.stringMatching(/already used/) });
  });

  it("requires a signature at all", async () => {
    expect(await verifyReportAuth({ auth: undefined, csv: CSV, deployment, client: client(), now: NOW })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a signature for a different file or chain", async () => {
    const otherFile = await signed({ csv: "something else" });
    expect(await verifyReportAuth({ auth: otherFile, csv: CSV, deployment, client: client(), now: NOW })).toMatchObject({ ok: false, status: 401 });
    const otherChain = await signed({ chainId: 84532 });
    expect(await verifyReportAuth({ auth: otherChain, csv: CSV, deployment, client: client(), now: NOW })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects expired signatures", async () => {
    const auth = await signed({ issuedAt: new Date(NOW - 10 * 60_000).toISOString() });
    expect(await verifyReportAuth({ auth, csv: CSV, deployment, client: client(), now: NOW })).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  it("rejects valid signatures from accounts without the role", async () => {
    const auth = await signed();
    expect(await verifyReportAuth({ auth, csv: CSV, deployment, client: client(false), now: NOW })).toMatchObject({ ok: false, status: 403 });
  });
});
