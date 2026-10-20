import { getAddress, isAddress, isHex, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { vestingRegistryAbi } from "@/lib/abi";
import {
  buildReportAuthMessage,
  REPORT_AUTH_MAX_AGE_MS,
  SCHEDULE_MANAGER_ROLE,
  sha256Hex,
  type ReportAuth,
} from "@/lib/reportAuth";
import type { Deployment } from "./config";

export type ReportAuthResult = { ok: true; address: Address } | { ok: false; status: number; error: string };

// Signatures already used, until they expire: blocks replaying a captured request.
const used = new Map<string, number>();

export function resetUsedReportSignatures() {
  used.clear();
}

/**
 * Verify a signed "save report" request: well-formed, fresh, bound to this chain + registry + CSV,
 * signed by `address` (EOA or smart-contract wallet such as a Safe), not replayed, and `address`
 * holds SCHEDULE_MANAGER_ROLE on-chain right now.
 */
export async function verifyReportAuth(input: {
  auth: unknown;
  csv: string;
  deployment: Deployment;
  client: Pick<PublicClient, "verifyMessage" | "readContract">;
  now?: number;
}): Promise<ReportAuthResult> {
  const now = input.now ?? Date.now();
  const a = input.auth as Partial<ReportAuth> | null | undefined;
  if (!a || typeof a !== "object") return { ok: false, status: 401, error: "A signature from a schedule manager is required to save reports" };
  if (typeof a.address !== "string" || !isAddress(a.address)) return { ok: false, status: 400, error: "auth.address is not a valid address" };
  if (typeof a.signature !== "string" || !isHex(a.signature) || a.signature.length < 132) {
    return { ok: false, status: 400, error: "auth.signature is not a valid signature" };
  }
  const issued = typeof a.issuedAt === "string" ? Date.parse(a.issuedAt) : NaN;
  if (Number.isNaN(issued)) return { ok: false, status: 400, error: "auth.issuedAt is not a valid timestamp" };
  if (now - issued > REPORT_AUTH_MAX_AGE_MS || issued - now > 60_000) {
    return { ok: false, status: 401, error: "Signature expired; sign again" };
  }

  for (const [sig, expires] of used) if (expires < now) used.delete(sig);
  const sigKey = keccak256(a.signature as Hex);
  if (used.has(sigKey)) return { ok: false, status: 401, error: "Signature already used; sign again" };

  const address = getAddress(a.address);
  const message = buildReportAuthMessage({
    chainId: input.deployment.chainId,
    registry: input.deployment.registry,
    csvSha256: await sha256Hex(input.csv),
    issuedAt: a.issuedAt!,
  });
  const valid = await input.client.verifyMessage({ address, message, signature: a.signature as Hex });
  if (!valid) return { ok: false, status: 401, error: "Signature does not match this file, registry or account" };

  const isManager = await input.client.readContract({
    address: input.deployment.registry,
    abi: vestingRegistryAbi,
    functionName: "hasRole",
    args: [SCHEDULE_MANAGER_ROLE, address],
  });
  if (!isManager) return { ok: false, status: 403, error: "Only accounts with SCHEDULE_MANAGER_ROLE can save reports" };

  used.set(sigKey, issued + REPORT_AUTH_MAX_AGE_MS);
  return { ok: true, address };
}
