export { SCHEDULE_MANAGER_ROLE } from "./abi";

/** How long a signed "save report" request stays valid. */
export const REPORT_AUTH_MAX_AGE_MS = 5 * 60_000;

export interface ReportAuthFields {
  chainId: number;
  registry: string;
  csvSha256: string;
  issuedAt: string;
}

export interface ReportAuth {
  address: string;
  signature: string;
  issuedAt: string;
}

/**
 * The exact text a role-holder signs (EIP-191 personal_sign) to save a report on a public network.
 * It binds the chain, the registry and the CSV content, and expires, so a signature can't be reused
 * for another file, deployment or network.
 */
export function buildReportAuthMessage(f: ReportAuthFields): string {
  return [
    "TokenFlow: save reconciliation report",
    "",
    "Signing proves you hold SCHEDULE_MANAGER_ROLE on this registry.",
    "It is not a transaction and costs no gas.",
    "",
    `Chain ID: ${f.chainId}`,
    `Registry: ${f.registry}`,
    `CSV SHA-256: ${f.csvSha256}`,
    `Issued at: ${f.issuedAt}`,
  ].join("\n");
}

/** Hex SHA-256 of UTF-8 text (Web Crypto: works in browsers and Node 22). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
