// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { idleTx } from "@/lib/txState";

const BENEFICIARY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const state = vi.hoisted(() => ({ address: undefined as string | undefined, run: vi.fn() }));

vi.mock("wagmi", () => ({ useConnection: () => ({ address: state.address }) }));
vi.mock("@/hooks/useTxFlow", () => ({
  useTxFlow: () => ({ state: idleTx, run: state.run, reset: vi.fn() }),
}));

import { ClaimButton } from "./ClaimButton";

const renderButton = (releasable: bigint | undefined) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClaimButton
        registry="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
        allocationIdHex="0x7465616d2d303031000000000000000000000000000000000000000000000000"
        beneficiary={BENEFICIARY}
        releasable={releasable}
      />
    </QueryClientProvider>,
  );

describe("ClaimButton", () => {
  it("is disabled when nothing is claimable", () => {
    state.address = BENEFICIARY;
    renderButton(0n);
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
    expect(screen.getByText("Nothing claimable yet")).toBeInTheDocument();
  });

  it("is disabled for anyone other than the beneficiary", () => {
    state.address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    renderButton(10n);
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
    expect(screen.getByText("Only the beneficiary can claim")).toBeInTheDocument();
  });

  it("calls release when the beneficiary has a claimable balance", async () => {
    state.address = BENEFICIARY.toLowerCase();
    state.run.mockResolvedValue(null);
    renderButton(10n);
    const button = screen.getByRole("button", { name: "Claim" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(state.run).toHaveBeenCalledWith(
      "Claim",
      expect.objectContaining({ functionName: "release", args: ["0x7465616d2d303031000000000000000000000000000000000000000000000000"] }),
    );
  });
});
