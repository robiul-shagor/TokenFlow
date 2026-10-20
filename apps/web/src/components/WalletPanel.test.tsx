// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: { status: "disconnected", chainId: undefined as number | undefined, address: undefined as string | undefined },
  switchMutate: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnection: () => state.connection,
  useSwitchChain: () => ({ mutate: state.switchMutate, isPending: false, error: null }),
  useConnect: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useConnectors: () => [],
  useDisconnect: () => ({ mutate: vi.fn() }),
}));

import { RequireLocalWallet } from "./WalletPanel";

const renderGate = () =>
  render(
    <RequireLocalWallet purpose="test">
      <p>protected content</p>
    </RequireLocalWallet>,
  );

describe("RequireLocalWallet", () => {
  beforeEach(() => {
    state.switchMutate.mockReset();
  });

  it("shows the disconnected state", () => {
    state.connection = { status: "disconnected", chainId: undefined, address: undefined };
    renderGate();
    expect(screen.getByTestId("wallet-disconnected")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("blocks unsupported chains and offers to switch to Anvil", async () => {
    state.connection = { status: "connected", chainId: 1, address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" };
    renderGate();
    expect(screen.getByTestId("wrong-network")).toHaveTextContent("Wrong network (chain 1)");
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /switch to anvil/i }));
    expect(state.switchMutate).toHaveBeenCalledWith({ chainId: 31337 });
  });

  it("renders children on the local chain and reacts to account/chain changes", () => {
    state.connection = { status: "connected", chainId: 31337, address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" };
    const { rerender } = renderGate();
    expect(screen.getByText("protected content")).toBeInTheDocument();

    state.connection = { status: "connected", chainId: 11155111, address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" };
    rerender(
      <RequireLocalWallet purpose="test">
        <p>protected content</p>
      </RequireLocalWallet>,
    );
    expect(screen.getByTestId("wrong-network")).toBeInTheDocument();
  });

  it("shows a connecting state while reconnecting", () => {
    state.connection = { status: "reconnecting", chainId: undefined, address: undefined };
    renderGate();
    expect(screen.getByText(/connecting wallet/i)).toBeInTheDocument();
  });
});
