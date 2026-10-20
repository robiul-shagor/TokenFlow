import { connection } from "next/server";
import type { ReactNode } from "react";
import { loadDeployment, publicRpcUrl } from "@/server/config";
import { Nav } from "./Nav";
import { Providers } from "./Providers";
import { WalletPanel } from "./WalletPanel";

/** Server component: reads the local deployment manifest at request time and boots the client app. */
export async function ConfiguredApp({ children }: { children: ReactNode }) {
  await connection();
  let appConfig;
  try {
    const d = loadDeployment();
    appConfig = { chainId: d.chainId, rpcUrl: publicRpcUrl(), registry: d.registry, token: d.token, admin: d.admin };
  } catch (err) {
    return (
      <main className="mx-auto max-w-2xl flex-1 p-8">
        <h1 className="text-lg font-semibold">Local setup incomplete</h1>
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{(err as Error).message}</p>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
          <li>
            Start the chain: <code>pnpm chain</code>
          </li>
          <li>
            Deploy contracts: <code>pnpm contracts:deploy</code>
          </li>
          <li>Reload this page.</li>
        </ol>
      </main>
    );
  }
  return (
    <Providers appConfig={appConfig}>
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold">TokenFlow</span>
            <Nav />
          </div>
          <WalletPanel />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-6">{children}</main>
    </Providers>
  );
}
