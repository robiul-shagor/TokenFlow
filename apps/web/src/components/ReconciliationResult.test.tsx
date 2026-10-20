// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { parseAllocationCsv } from "@/lib/csv";
import { reconcile } from "@/lib/reconcile";
import { serializeReport } from "@/server/reports";
import { ReconciliationResult } from "./ReconciliationResult";

const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const csv = [
  "allocation_id,beneficiary,token_address,expected_amount,start_timestamp,cliff_seconds,duration_seconds",
  `a,${A},${TOKEN},1,100,0,1000`,
  `b,${A},${TOKEN},2,100,0,1000`,
].join("\n");

function makeReport(stale: boolean) {
  const report = reconcile(
    parseAllocationCsv(csv, { decimals: 18, tokenAddress: TOKEN }),
    [{ allocationId: "a", beneficiary: A, totalAmountRaw: 10n ** 18n, start: 100n, cliffDuration: 0n, duration: 1000n }],
    {
      chainId: 31337,
      contractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      tokenAddress: TOKEN,
      tokenDecimals: 18,
      indexedBlock: 7n,
      chainHeadBlock: stale ? 9n : 7n,
      stale,
      sourceFilename: "x.csv",
      generatedAt: "2026-10-20T00:00:00.000Z",
    },
  );
  return serializeReport(5, report);
}

describe("ReconciliationResult", () => {
  it("shows chain, contract, block context and summary", () => {
    render(<ReconciliationResult report={makeReport(false)} />);
    expect(screen.getByRole("heading", { name: "Reconciliation report #5" })).toBeInTheDocument();
    expect(screen.getByText("Block 7")).toBeInTheDocument();
    expect(screen.getByText("Up to date with head")).toBeInTheDocument();
    expect(screen.getByText(/31337/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/reconciliation/5/export");
    const chips = screen.getByRole("group", { name: "Filter rows by status" });
    expect(within(chips).getByRole("button", { name: /Matched/ })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: /Missing on-chain/ })).toBeInTheDocument();
  });

  it("warns prominently when generated from a stale index", () => {
    render(<ReconciliationResult report={makeReport(true)} />);
    expect(screen.getByText("The index was 2 blocks behind the chain head (9).")).toBeInTheDocument();
    expect(screen.getAllByText("Cannot verify yet (indexer behind)").length).toBeGreaterThan(0);
  });

  it("defaults to rows needing attention and can show all", async () => {
    render(<ReconciliationResult report={makeReport(false)} />);
    const table = screen.getByRole("region", { name: "Reconciliation rows" });
    expect(within(table).queryByText("a")).not.toBeInTheDocument();
    expect(within(table).getByText("b")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^All\s*\d/ }));
    expect(within(table).getByText("a")).toBeInTheDocument();
  });

  it("shows the selected row's detail and switches amount units", async () => {
    render(<ReconciliationResult report={makeReport(false)} />);
    const detail = screen.getByRole("complementary", { name: "Selected row detail" });
    expect(within(detail).getByRole("heading", { name: "b" })).toBeInTheDocument();
    expect(within(detail).getByText(/Create and fund this allocation/)).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Create this allocation" })).toHaveAttribute(
      "href",
      `/allocations/new?fromReport=5&id=b&beneficiary=${A}&amountRaw=2000000000000000000`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Raw integers" }));
    expect(within(detail).getByText("2000000000000000000")).toBeInTheDocument();
  });
});
