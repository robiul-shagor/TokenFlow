import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { createDb } from "@/db/client";

/** Integration tests need Anvil, Postgres and compiled contracts. They are skipped if any is missing. */
const CONTRACTS_OUT = resolve(__dirname, "../../../../contracts/out");
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/tokenflow_test";
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;

function findAnvil(): string | null {
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;
  const foundry = join(homedir(), ".foundry", "bin", "anvil");
  if (existsSync(foundry)) return foundry;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (existsSync(join(dir, "anvil"))) return join(dir, "anvil");
  }
  return null;
}

export const integrationAvailable =
  findAnvil() !== null && existsSync(join(CONTRACTS_OUT, "VestingRegistry.sol", "VestingRegistry.json"));

// CI sets REQUIRE_INTEGRATION=1 so a missing Anvil or missing build artifacts fail loudly instead of skipping.
if (process.env.REQUIRE_INTEGRATION === "1" && !integrationAvailable) {
  throw new Error("Integration tests required but Anvil or contracts/out artifacts are missing");
}

// Anvil's public default accounts; Anvil signs for them (unlocked), so no private key is used here.
export const ISSUER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const ALICE: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const BOB: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

export const chain = defineChain({
  id: 31337,
  name: "Anvil (test)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

function artifact(file: string, name: string): { abi: unknown[]; bytecode: Hex } {
  const json = JSON.parse(readFileSync(join(CONTRACTS_OUT, file, `${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export async function startAnvil(): Promise<ChildProcess> {
  const proc = spawn(findAnvil()!, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  const client = createPublicClient({ chain, transport: http(RPC) });
  for (let i = 0; i < 50; i++) {
    try {
      await client.getChainId();
      return proc;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error("Anvil did not start");
}

export function clients() {
  const transport = http(RPC);
  return {
    publicClient: createPublicClient({ chain, transport, pollingInterval: 50 }),
    wallet: (account: Address) => createWalletClient({ chain, transport, account }),
    testClient: createTestClient({ chain, transport, mode: "anvil" }),
  };
}

export async function deployContracts() {
  const { publicClient, wallet } = clients();
  const issuer = wallet(ISSUER);
  const tokenArt = artifact("MockERC20.sol", "MockERC20");
  const registryArt = artifact("VestingRegistry.sol", "VestingRegistry");
  const tokenHash = await issuer.deployContract({ abi: tokenArt.abi, bytecode: tokenArt.bytecode });
  const token = getAddress((await publicClient.waitForTransactionReceipt({ hash: tokenHash })).contractAddress!);
  const deployBlock = await publicClient.getBlockNumber();
  const regHash = await issuer.deployContract({
    abi: registryArt.abi,
    bytecode: registryArt.bytecode,
    args: [token, ISSUER],
  });
  const registry = getAddress((await publicClient.waitForTransactionReceipt({ hash: regHash })).contractAddress!);
  return { token, registry, deployBlock };
}

export async function openTestDb() {
  const { db, close } = createDb(TEST_DATABASE_URL);
  await migrate(db, { migrationsFolder: resolve(__dirname, "../../drizzle") });
  await db.execute(
    sql`TRUNCATE indexed_events, allocations, indexer_cursors, reconciliation_rows, reconciliation_reports RESTART IDENTITY CASCADE`,
  );
  return { db, close };
}
