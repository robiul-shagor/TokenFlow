import Papa from "papaparse";
import { getAddress, isAddress, type Address } from "viem";
import { isValidAllocationId } from "./allocationId";
import { parseTokenAmount } from "./amounts";

export const CSV_COLUMNS = [
  "allocation_id",
  "beneficiary",
  "token_address",
  "expected_amount",
  "start_timestamp",
  "cliff_seconds",
  "duration_seconds",
] as const;

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 10_000;
const UINT64_MAX = 2n ** 64n - 1n;

export interface ExpectedAllocation {
  /** 1-based line number in the source file (the header is line 1). */
  rowNumber: number;
  allocationId: string;
  beneficiary: Address;
  tokenAddress: Address;
  /** Exact raw token units (human amount × 10^decimals). */
  expectedAmountRaw: bigint;
  start: bigint;
  cliffDuration: bigint;
  duration: bigint;
}

export interface CsvRowIssue {
  rowNumber: number;
  kind: "invalid" | "duplicate";
  allocationId: string | null;
  beneficiary: string | null;
  expectedAmountRaw: bigint | null;
  message: string;
}

export interface CsvParseResult {
  /** File-level problems (missing columns, too large). When non-empty, no rows are usable. */
  fileErrors: string[];
  rows: ExpectedAllocation[];
  issues: CsvRowIssue[];
  totalDataRows: number;
}

export interface CsvParseOptions {
  /** Token decimals used to convert human-readable amounts into raw units. */
  decimals: number;
  /** The configured token; rows naming another token are invalid. */
  tokenAddress: Address;
}

function parseUint(value: string, field: string, max = UINT64_MAX): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be a non-negative integer, got "${value}"`);
  const n = BigInt(value);
  if (n > max) throw new Error(`${field} is out of range`);
  return n;
}

/**
 * Parse and validate an allocation CSV. Never throws for bad content: every problem is reported either as
 * a file error or a row issue. Rows sharing an allocation_id are ALL reported as duplicates and excluded,
 * rather than silently picking one.
 */
export function parseAllocationCsv(text: string, opts: CsvParseOptions): CsvParseResult {
  const result: CsvParseResult = { fileErrors: [], rows: [], issues: [], totalDataRows: 0 };

  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) {
    result.fileErrors.push(`File is larger than ${MAX_CSV_BYTES} bytes`);
    return result;
  }

  // header:false so that array index maps directly to the line number (blank lines are kept, then ignored).
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: false });
  const lines = parsed.data;
  const headerIndex = lines.findIndex((cells) => cells.some((c) => c.trim() !== ""));
  if (headerIndex === -1) {
    result.fileErrors.push("File is empty");
    return result;
  }

  const header = lines[headerIndex].map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    result.fileErrors.push(`Missing required column(s): ${missing.join(", ")}`);
    return result;
  }
  const col = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof CSV_COLUMNS)[number],
    number
  >;

  const parseErrorsByRow = new Map<number, string>();
  for (const err of parsed.errors) {
    if (typeof err.row === "number") parseErrorsByRow.set(err.row, err.message);
  }

  const candidates: ExpectedAllocation[] = [];
  const configuredToken = opts.tokenAddress.toLowerCase();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = lines[i];
    if (cells.every((c) => c.trim() === "")) continue;
    result.totalDataRows++;
    if (result.totalDataRows > MAX_CSV_ROWS) {
      result.fileErrors.push(`File has more than ${MAX_CSV_ROWS} data rows`);
      result.rows = [];
      result.issues = [];
      return result;
    }

    const rowNumber = i + 1;
    const get = (c: (typeof CSV_COLUMNS)[number]) => (cells[col[c]] ?? "").trim();
    const allocationId = get("allocation_id");
    const beneficiaryRaw = get("beneficiary");
    const invalid = (message: string, expectedAmountRaw: bigint | null = null) =>
      result.issues.push({
        rowNumber,
        kind: "invalid",
        allocationId: allocationId || null,
        beneficiary: beneficiaryRaw || null,
        expectedAmountRaw,
        message,
      });

    const parseError = parseErrorsByRow.get(i);
    if (parseError) {
      invalid(`Malformed CSV row: ${parseError}`);
      continue;
    }
    if (cells.length !== header.length) {
      invalid(`Expected ${header.length} columns, found ${cells.length}`);
      continue;
    }
    if (!isValidAllocationId(allocationId)) {
      invalid(`Invalid allocation_id "${allocationId}" (1-31 chars of A-Z a-z 0-9 . _ -)`);
      continue;
    }
    if (!isAddress(beneficiaryRaw)) {
      invalid(`Invalid beneficiary address "${beneficiaryRaw}"`);
      continue;
    }
    const beneficiary = getAddress(beneficiaryRaw);
    if (beneficiary === "0x0000000000000000000000000000000000000000") {
      invalid("Beneficiary cannot be the zero address");
      continue;
    }
    const tokenRaw = get("token_address");
    if (!isAddress(tokenRaw)) {
      invalid(`Invalid token_address "${tokenRaw}"`);
      continue;
    }
    if (tokenRaw.toLowerCase() !== configuredToken) {
      invalid(`token_address ${tokenRaw} does not match the configured token ${opts.tokenAddress}`);
      continue;
    }

    let expectedAmountRaw: bigint;
    try {
      expectedAmountRaw = parseTokenAmount(get("expected_amount"), opts.decimals);
    } catch (e) {
      invalid(`Invalid expected_amount: ${(e as Error).message}`);
      continue;
    }
    if (expectedAmountRaw === 0n) {
      invalid("expected_amount must be greater than zero", expectedAmountRaw);
      continue;
    }

    let start: bigint, cliffDuration: bigint, duration: bigint;
    try {
      start = parseUint(get("start_timestamp"), "start_timestamp");
      cliffDuration = parseUint(get("cliff_seconds"), "cliff_seconds");
      duration = parseUint(get("duration_seconds"), "duration_seconds");
    } catch (e) {
      invalid((e as Error).message, expectedAmountRaw);
      continue;
    }
    if (duration === 0n) {
      invalid("duration_seconds must be greater than zero", expectedAmountRaw);
      continue;
    }
    if (cliffDuration > duration) {
      invalid("cliff_seconds cannot exceed duration_seconds", expectedAmountRaw);
      continue;
    }

    candidates.push({
      rowNumber,
      allocationId,
      beneficiary,
      tokenAddress: getAddress(tokenRaw),
      expectedAmountRaw,
      start,
      cliffDuration,
      duration,
    });
  }

  // Duplicate detection includes ids that also appear on invalid rows: the operator must resolve them.
  const idCounts = new Map<string, number>();
  for (const id of [...candidates.map((r) => r.allocationId), ...result.issues.map((i) => i.allocationId)]) {
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const row of candidates) {
    if ((idCounts.get(row.allocationId) ?? 0) > 1) {
      result.issues.push({
        rowNumber: row.rowNumber,
        kind: "duplicate",
        allocationId: row.allocationId,
        beneficiary: row.beneficiary,
        expectedAmountRaw: row.expectedAmountRaw,
        message: `allocation_id "${row.allocationId}" appears ${idCounts.get(row.allocationId)} times in the file`,
      });
    } else {
      result.rows.push(row);
    }
  }
  result.issues.sort((a, b) => a.rowNumber - b.rowNumber);
  return result;
}
