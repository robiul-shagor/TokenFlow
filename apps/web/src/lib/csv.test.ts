import { describe, expect, it } from "vitest";
import { parseAllocationCsv } from "./csv";

const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const HEADER = "allocation_id,beneficiary,token_address,expected_amount,start_timestamp,cliff_seconds,duration_seconds";
const opts = { decimals: 18, tokenAddress: TOKEN } as const;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("parseAllocationCsv", () => {
  it("parses valid rows into exact raw units", () => {
    const r = parseAllocationCsv(csv(`team-001,${A},${TOKEN},1000.5,1767225600,0,63072000`), opts);
    expect(r.fileErrors).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      rowNumber: 2,
      allocationId: "team-001",
      beneficiary: A,
      expectedAmountRaw: 10005n * 10n ** 17n,
      start: 1767225600n,
      cliffDuration: 0n,
      duration: 63072000n,
    });
  });

  it("accepts lowercase addresses and normalises them to checksum form", () => {
    const r = parseAllocationCsv(csv(`x,${A.toLowerCase()},${TOKEN.toLowerCase()},1,1,0,1`), opts);
    expect(r.rows[0].beneficiary).toBe(A);
  });

  it("reports missing columns as a file error", () => {
    const r = parseAllocationCsv("allocation_id,beneficiary\nx,y", opts);
    expect(r.fileErrors[0]).toMatch(/Missing required column/);
    expect(r.rows).toEqual([]);
  });

  it("reports an empty file", () => {
    expect(parseAllocationCsv("\n\n", opts).fileErrors).toEqual(["File is empty"]);
  });

  it("reports invalid rows with line numbers and keeps valid ones", () => {
    const r = parseAllocationCsv(
      csv(
        `ok-1,${A},${TOKEN},1,1,0,10`,
        `bad-addr,0x123,${TOKEN},1,1,0,10`,
        `bad-checksum,${A.replace("C", "c").replace("d", "D")},${TOKEN},1,1,0,10`,
        `neg,${A},${TOKEN},-5,1,0,10`,
        `float,${A},${TOKEN},1e3,1,0,10`,
        `zero,${A},${TOKEN},0,1,0,10`,
        `cliff,${A},${TOKEN},1,1,20,10`,
        `dur,${A},${TOKEN},1,1,0,0`,
        `token,${A},${B},1,1,0,10`,
        `bad id!,${A},${TOKEN},1,1,0,10`,
        `cols,${A},${TOKEN},1`,
        `zeroaddr,0x0000000000000000000000000000000000000000,${TOKEN},1,1,0,10`,
      ),
      opts,
    );
    expect(r.rows.map((x) => x.allocationId)).toEqual(["ok-1"]);
    expect(r.issues.map((i) => [i.rowNumber, i.kind])).toEqual([
      [3, "invalid"],
      [4, "invalid"],
      [5, "invalid"],
      [6, "invalid"],
      [7, "invalid"],
      [8, "invalid"],
      [9, "invalid"],
      [10, "invalid"],
      [11, "invalid"],
      [12, "invalid"],
      [13, "invalid"],
    ]);
    expect(r.issues.find((i) => i.allocationId === "token")?.message).toMatch(/does not match the configured token/);
    expect(r.issues.find((i) => i.allocationId === "cliff")?.message).toMatch(/cannot exceed/);
  });

  it("flags every occurrence of a duplicated allocation_id and excludes them", () => {
    const r = parseAllocationCsv(
      csv(`dup,${A},${TOKEN},1,1,0,10`, `uniq,${A},${TOKEN},1,1,0,10`, `dup,${B},${TOKEN},2,1,0,10`),
      opts,
    );
    expect(r.rows.map((x) => x.allocationId)).toEqual(["uniq"]);
    expect(r.issues.filter((i) => i.kind === "duplicate").map((i) => i.rowNumber)).toEqual([2, 4]);
  });

  it("skips blank lines without shifting line numbers and strips a BOM", () => {
    const r = parseAllocationCsv(`﻿${HEADER}\n\nx,${A},${TOKEN},1,1,0,10\n`, opts);
    expect(r.rows[0].rowNumber).toBe(3);
    expect(r.totalDataRows).toBe(1);
  });

  it("keeps huge amounts exact", () => {
    const r = parseAllocationCsv(csv(`big,${A},${TOKEN},99999999999999999999999999.999999999999999999,1,0,10`), opts);
    expect(r.rows[0].expectedAmountRaw).toBe(99999999999999999999999999999999999999999999n);
  });

  it("rejects oversize files", () => {
    const r = parseAllocationCsv("x".repeat(1_000_001), opts);
    expect(r.fileErrors[0]).toMatch(/larger than/);
  });
});
