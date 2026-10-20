import { describe, expect, it } from "vitest";
import { parseAllocationCsv } from "./csv";
import { reconcile, reportToCsv, type IndexedAllocation, type ReconciliationMeta } from "./reconcile";

const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const HEADER = "allocation_id,beneficiary,token_address,expected_amount,start_timestamp,cliff_seconds,duration_seconds";
const E18 = 10n ** 18n;
const parse = (...rows: string[]) => parseAllocationCsv([HEADER, ...rows].join("\n"), { decimals: 18, tokenAddress: TOKEN });

const meta = (over: Partial<ReconciliationMeta> = {}): ReconciliationMeta => ({
  chainId: 31337,
  contractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  tokenAddress: TOKEN,
  tokenDecimals: 18,
  indexedBlock: 10n,
  chainHeadBlock: 10n,
  stale: false,
  sourceFilename: "test.csv",
  generatedAt: "2026-10-20T00:00:00.000Z",
  ...over,
});

const onchain = (id: string, beneficiary: string, amount: bigint, over: Partial<IndexedAllocation> = {}) =>
  ({ allocationId: id, beneficiary, totalAmountRaw: amount, start: 100n, cliffDuration: 0n, duration: 1000n, ...over }) as IndexedAllocation;

describe("reconcile", () => {
  it("reports all rows matched", () => {
    const r = reconcile(
      parse(`a,${A},${TOKEN},1,100,0,1000`, `b,${B},${TOKEN},2.5,100,0,1000`),
      [onchain("a", A, E18), onchain("b", B, 25n * 10n ** 17n)],
      meta(),
    );
    expect(r.summary.matched).toBe(2);
    expect(r.summary.totalRows).toBe(2);
    expect(r.rows.every((x) => x.status === "matched")).toBe(true);
  });

  it("detects missing, unexpected, amount, beneficiary and schedule mismatches", () => {
    const r = reconcile(
      parse(
        `missing,${A},${TOKEN},1,100,0,1000`,
        `amount,${A},${TOKEN},300,100,0,1000`,
        `benef,${A},${TOKEN},1,100,0,1000`,
        `sched,${A},${TOKEN},1,100,50,1000`,
      ),
      [
        onchain("amount", A, 250n * E18),
        onchain("benef", B, E18),
        onchain("sched", A, E18),
        onchain("extra", B, 7n * E18),
      ],
      meta(),
    );
    const byId = Object.fromEntries(r.rows.map((x) => [x.allocationId, x]));
    expect(byId.missing.status).toBe("missing_onchain");
    expect(byId.amount.status).toBe("amount_mismatch");
    expect(byId.amount.expectedAmountRaw).toBe(300n * E18);
    expect(byId.amount.actualAmountRaw).toBe(250n * E18);
    expect(byId.benef.status).toBe("beneficiary_mismatch");
    expect(byId.sched.status).toBe("schedule_mismatch");
    expect(byId.sched.message).toMatch(/cliff 0s vs 50s/);
    expect(byId.extra.status).toBe("unexpected_onchain");
    expect(byId.extra.sourceRowNumber).toBeNull();
  });

  it("reports beneficiary mismatch first but explains every difference", () => {
    const r = reconcile(parse(`x,${A},${TOKEN},1,100,0,1000`), [onchain("x", B, 2n * E18)], meta());
    expect(r.rows[0].status).toBe("beneficiary_mismatch");
    expect(r.rows[0].message).toMatch(/beneficiary/i);
    expect(r.rows[0].message).toMatch(/amount/);
  });

  it("includes duplicate and invalid rows, and does not mark their ids as unexpected", () => {
    const r = reconcile(
      parse(`d,${A},${TOKEN},1,100,0,1000`, `d,${A},${TOKEN},1,100,0,1000`, `bad,0xnope,${TOKEN},1,100,0,1000`),
      [onchain("d", A, E18), onchain("bad", A, E18)],
      meta(),
    );
    expect(r.summary.duplicate_csv).toBe(2);
    expect(r.summary.invalid_row).toBe(1);
    expect(r.summary.unexpected_onchain).toBe(0);
  });

  it("marks unknown rows as pending_indexing when the index is stale", () => {
    const r = reconcile(parse(`new,${A},${TOKEN},1,100,0,1000`), [], meta({ stale: true, chainHeadBlock: 20n }));
    expect(r.rows[0].status).toBe("pending_indexing");
    expect(r.rows[0].message).toMatch(/indexed block 10/);
  });

  it("compares large integer amounts exactly", () => {
    const amount = "123456789012345678901234567890.123456789012345678";
    const raw = 123456789012345678901234567890123456789012345678n;
    expect(reconcile(parse(`x,${A},${TOKEN},${amount},100,0,1000`), [onchain("x", A, raw)], meta()).summary.matched).toBe(1);
    expect(
      reconcile(parse(`x,${A},${TOKEN},${amount},100,0,1000`), [onchain("x", A, raw + 1n)], meta()).summary
        .amount_mismatch,
    ).toBe(1);
  });

  it("refuses to reconcile a file with file-level errors", () => {
    const bad = parseAllocationCsv("nope", { decimals: 18, tokenAddress: TOKEN });
    expect(() => reconcile(bad, [], meta())).toThrow(/invalid file/);
  });
});

describe("reportToCsv", () => {
  it("retains statuses, exact amounts and report metadata", () => {
    const report = reconcile(
      parse(`a,${A},${TOKEN},1,100,0,1000`, `b,${A},${TOKEN},5,100,0,1000`),
      [onchain("a", A, E18), onchain("b", A, 4n * E18)],
      meta({ stale: true, indexedBlock: 42n }),
    );
    const out = reportToCsv(report);
    expect(out).toContain("# chain_id=31337");
    expect(out).toContain("# contract=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
    expect(out).toContain("indexed_block=42");
    expect(out).toContain("stale=true");
    expect(out).toContain(`2,a,${A},1000000000000000000,1000000000000000000,matched,`);
    expect(out).toContain(`3,b,${A},5000000000000000000,4000000000000000000,amount_mismatch,`);
  });

  it("escapes quotes/commas and neutralises formula injection", () => {
    const report = reconcile(parse(`a,${A},${TOKEN},1,100,0,1000`), [], meta());
    report.rows[0].message = '=HYPERLINK("x"), test';
    expect(reportToCsv(report)).toContain(`"'=HYPERLINK(""x""), test"`);
  });
});
