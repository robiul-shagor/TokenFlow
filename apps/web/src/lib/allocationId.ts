import { hexToString, stringToHex, type Hex } from "viem";

/** Allocation IDs are short ASCII strings stored on-chain as right-padded bytes32. */
export const ALLOCATION_ID_RE = /^[A-Za-z0-9._-]{1,31}$/;

export function isValidAllocationId(id: string): boolean {
  return ALLOCATION_ID_RE.test(id);
}

export function encodeAllocationId(id: string): Hex {
  if (!isValidAllocationId(id)) {
    throw new Error(`Invalid allocation id "${id}": use 1-31 characters of A-Z a-z 0-9 . _ -`);
  }
  return stringToHex(id, { size: 32 });
}

/** Decode a bytes32 allocation id. IDs created outside the app may not be printable; fall back to hex. */
export function decodeAllocationId(raw: Hex): string {
  const decoded = hexToString(raw, { size: 32 }).replace(/\0+$/, "");
  return isValidAllocationId(decoded) ? decoded : raw;
}
