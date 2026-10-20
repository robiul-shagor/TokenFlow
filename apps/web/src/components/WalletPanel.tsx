"use client";

import { useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useNetwork } from "./Providers";
import { useMounted } from "@/hooks/useMounted";
import { Badge, Hex } from "./ui";

export function WalletPanel() {
  const { address, chainId, status, connector } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const mounted = useMounted();
  const network = useNetwork();
  const onNetwork = chainId === network.chain.id;

  if (!mounted) return <span className="text-xs text-slate-500">Wallet…</span>;
  if (status === "connected" && address) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={onNetwork ? "good" : "bad"}>
          {onNetwork ? `${network.chain.name} · ${chainId}` : `Unsupported chain ${chainId}`}
        </Badge>
        <span className="text-xs text-slate-500">{connector?.name}</span>
        <Hex value={address} chars={4} kind="address" />
        <button className="btn-secondary" onClick={() => disconnect.mutate()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="sr-only" htmlFor="connector">
        Connect with
      </label>
      <select
        id="connector"
        className="input w-auto py-1"
        defaultValue=""
        disabled={status === "connecting" || connect.isPending}
        onChange={(e) => {
          const c = connectors.find((x) => x.id === e.target.value);
          if (c) connect.mutate({ connector: c, chainId: network.chain.id });
          e.target.value = "";
        }}
      >
        <option value="" disabled>
          {connect.isPending ? "Connecting…" : "Connect wallet…"}
        </option>
        {connectors.map((c) => (
          <option key={c.uid} value={c.id}>
            {c.id === "injected" ? (network.kind === "local" ? "Browser wallet (local RPC)" : "Browser wallet") : c.name}
          </option>
        ))}
      </select>
      {connect.error && <span className="text-xs text-red-600">{connect.error.message.split("\n")[0]}</span>}
    </div>
  );
}

/** Renders children only for a connected wallet on the local chain; otherwise explains what is wrong. */
export function RequireLocalWallet({ children, purpose }: { children: React.ReactNode; purpose: string }) {
  const { status, chainId } = useConnection();
  const switchChain = useSwitchChain();
  const mounted = useMounted();
  const network = useNetwork();
  const target = network.chain.id;

  if (!mounted || status === "connecting" || status === "reconnecting") {
    return <p className="text-sm text-slate-500">Connecting wallet…</p>;
  }
  if (status !== "connected") {
    return (
      <section
        data-testid="wallet-disconnected"
        className="flex flex-col items-center gap-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center"
      >
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="text-slate-500">
          <rect x="5" y="11" width="30" height="21" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M9 11V9a3 3 0 0 1 3-3h16" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="28" cy="21.5" r="2" fill="currentColor" />
        </svg>
        <h2 className="text-lg font-semibold">Connect a wallet to {purpose}</h2>
        <p className="max-w-lg text-sm text-slate-600 dark:text-slate-400">
          {network.kind === "local"
            ? "Pick an Anvil dev account in the top bar, or point a browser wallet at http://127.0.0.1:8545 with a disposable Anvil key in a development-only profile."
            : `Connect a browser wallet on ${network.label}. Use a test-only account: TokenFlow tokens have no value and the contracts are not audited.`}{" "}
          Never import a real seed phrase.
        </p>
      </section>
    );
  }
  if (chainId !== target) {
    return (
      <div
        role="alert"
        data-testid="wrong-network"
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
      >
        <div className="min-w-0 flex-[1_1_420px]">
          <p>
            <strong>Wrong network (chain {chainId}).</strong> This TokenFlow deployment runs on {network.label} (
            {target}). Balances and transactions stay hidden until you switch, so you never read figures from the
            wrong chain.
          </p>
          {switchChain.error && <p className="mt-2 text-xs">{switchChain.error.message.split("\n")[0]}</p>}
        </div>
        <button
          className="inline-flex min-h-11 items-center rounded-lg border border-red-800 bg-white px-4 font-semibold text-red-900 disabled:opacity-50 dark:bg-transparent dark:text-red-200"
          disabled={switchChain.isPending}
          onClick={() => switchChain.mutate({ chainId: target })}
        >
          Switch to {network.chain.name} ({target})
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
