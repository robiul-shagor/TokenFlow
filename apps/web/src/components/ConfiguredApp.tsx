import { connection } from "next/server";
import type { ReactNode } from "react";
import type { NetworkProfile } from "@/lib/chain";
import { loadDeployment, networkProfile, publicRpcUrl, reportSignatureRequired } from "@/server/config";
import { Nav } from "./Nav";
import { Providers } from "./Providers";
import { WalletPanel } from "./WalletPanel";

/** Safety banner shown on every page; wording follows the active network profile. */
function NetworkBanner({ profile }: { profile: NetworkProfile | null }) {
  const text =
    profile?.kind === "testnet"
      ? `TESTNET DEMO · ${profile.label} (${profile.chain.id}) · test tokens have no monetary value · not audited`
      : "LOCAL DEVELOPMENT ONLY · Anvil chain 31337 · test tokens have no monetary value · not audited";
  return <div className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950">{text}</div>;
}

/** Server component: reads the deployment for the active network at request time and boots the client app. */
export async function ConfiguredApp({ children }: { children: ReactNode }) {
  await connection();
  let appConfig;
  let profile: NetworkProfile | null = null;
  try {
    profile = networkProfile();
    const d = loadDeployment(undefined, profile);
    appConfig = {
      network: profile.name,
      chainId: d.chainId,
      rpcUrl: publicRpcUrl(profile),
      registry: d.registry,
      token: d.token,
      admin: d.admin,
      reportSignatureRequired: reportSignatureRequired(profile),
    };
  } catch (err) {
    return (
      <>
        <NetworkBanner profile={profile} />
        <main className="mx-auto max-w-2xl flex-1 p-8">
          <h1 className="text-lg font-semibold">Setup incomplete</h1>
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">{(err as Error).message}</p>
          {profile?.kind !== "testnet" ? (
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
              <li>
                Start the chain: <code>pnpm chain</code>
              </li>
              <li>
                Deploy contracts: <code>pnpm contracts:deploy</code>
              </li>
              <li>Reload this page.</li>
            </ol>
          ) : (
            <p className="mt-4 text-sm">
              See <code>docs/deployment.md</code> for deploying to a testnet and configuring the app.
            </p>
          )}
        </main>
      </>
    );
  }
  return (
    <Providers appConfig={appConfig}>
      <NetworkBanner profile={profile} />
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
