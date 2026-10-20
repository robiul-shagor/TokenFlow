// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { idleTx, type TxState } from "@/lib/txState";
import { TxStatusView } from "./TxStatusView";

const tx = (over: Partial<TxState>): TxState => ({ ...idleTx, label: "Claim", ...over });

describe("TxStatusView", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<TxStatusView state={idleTx} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["preparing", /Claim: preparing/],
    ["awaiting_signature", /Claim: awaiting confirmation/],
    ["pending", /Claim: pending/],
    ["confirmed", /Claim: confirmed/],
    ["rejected", /Claim: rejected/],
    ["failed", /Claim: failed/],
  ] as const)("renders %s", (status, text) => {
    render(<TxStatusView state={tx({ status, hash: "0xabc", blockNumber: 12n, error: "Nothing is claimable yet." })} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("shows the hash while pending and the block once confirmed", () => {
    const hash = "0x1234567890123456789012345678901234567890123456789012345678901234";
    const { rerender } = render(<TxStatusView state={tx({ status: "pending", hash })} />);
    expect(screen.getByTitle(hash)).toBeInTheDocument();
    rerender(<TxStatusView state={tx({ status: "confirmed", hash, blockNumber: 42n })} />);
    expect(screen.getByText(/Mined in block 42/)).toBeInTheDocument();
  });

  it("explains failures and rejections", () => {
    render(<TxStatusView state={tx({ status: "failed", error: "Only the beneficiary can claim this allocation." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Only the beneficiary can claim this allocation.");
  });
});
