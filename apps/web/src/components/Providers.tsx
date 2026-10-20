"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { createConfig, http, WagmiProvider, type CreateConnectorFn } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import { LOCAL_CHAIN } from "@/lib/chain";

export interface AppConfig {
  chainId: number;
  rpcUrl: string;
  registry: Address;
  token: Address;
  admin: Address;
}

/** Anvil's well-known default accounts #0-#2. Public, disposable, LOCAL DEVELOPMENT ONLY. */
export const DEV_ACCOUNTS = [
  { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", label: "Anvil #0 (issuer/admin)" },
  { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", label: "Anvil #1 (beneficiary)" },
  { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", label: "Anvil #2 (beneficiary)" },
] as const;

const DEV_ACCOUNT_KEY = "tokenflow.devAccount";

function rememberDevAccount(id: string | null) {
  try {
    if (id) localStorage.setItem(DEV_ACCOUNT_KEY, id);
    else localStorage.removeItem(DEV_ACCOUNT_KEY);
  } catch {
    // Storage unavailable (private mode): the dev account simply won't survive a reload.
  }
}

function rememberedDevAccount(): string | null {
  try {
    return localStorage.getItem(DEV_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/**
 * A dev-account connector: wraps wagmi's `mock` connector so transactions are sent with
 * `eth_sendTransaction` to Anvil, which signs with its own unlocked dev account. No private key ever
 * reaches the browser. These are real local-chain transactions, not simulations.
 * The chosen account is remembered so it survives a reload, and forgotten on disconnect.
 */
function anvilDevAccount(address: Address, label: string, index: number): CreateConnectorFn {
  const id = `anvil-dev-${index}`;
  const base = mock({ accounts: [address], features: { reconnect: true, defaultConnected: true } });
  return (config) => {
    const connector = base(config);
    return {
      ...connector,
      id,
      name: label,
      async connect(params) {
        const result = await connector.connect.call(this, params);
        rememberDevAccount(id);
        return result;
      },
      async disconnect() {
        rememberDevAccount(null);
        await connector.disconnect.call(this);
      },
      async isAuthorized() {
        return rememberedDevAccount() === id;
      },
    } as typeof connector;
  };
}

const AppConfigContext = createContext<AppConfig | null>(null);

export function useAppConfig(): AppConfig {
  const value = useContext(AppConfigContext);
  if (!value) throw new Error("useAppConfig must be used inside <Providers>");
  return value;
}

function WagmiShell({ appConfig, children }: { appConfig: AppConfig; children: ReactNode }) {
  const wagmiConfig = useMemo(
    () =>
      createConfig({
        chains: [LOCAL_CHAIN],
        connectors: [
          injected(),
          ...DEV_ACCOUNTS.map((a, i) => anvilDevAccount(a.address, a.label, i)),
        ],
        transports: { [LOCAL_CHAIN.id]: http(appConfig.rpcUrl) },
        ssr: true,
        // Anvil mines instantly; poll receipts/blocks faster than the 4s default.
        pollingInterval: 1_000,
      }),
    [appConfig.rpcUrl],
  );
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <AppConfigContext.Provider value={appConfig}>{children}</AppConfigContext.Provider>
    </WagmiProvider>
  );
}

/** `appConfig` is loaded on the server from the local deployment manifest (see ConfiguredApp). */
export function Providers({ appConfig, children }: { appConfig: AppConfig; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiShell appConfig={appConfig}>{children}</WagmiShell>
    </QueryClientProvider>
  );
}
