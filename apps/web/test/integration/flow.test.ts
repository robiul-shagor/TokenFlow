import type { ChildProcess } from "node:child_process";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { Db } from "@/db/client";
import { allocations, indexedEvents, indexerCursors } from "@/db/schema";
import {
  ChainMismatchError,
  getCursor,
  indexBatch,
  indexToHead,
  resetIndex,
  withRetry,
  type IndexerDeps,
} from "@/indexer/indexer";
import { erc20Abi, vestingRegistryAbi } from "@/lib/abi";
import { encodeAllocationId } from "@/lib/allocationId";
import { reportToCsv } from "@/lib/reconcile";
import { loadReport, runAndSaveReconciliation } from "@/server/reports";
import type { Deployment } from "@/server/config";
import { ALICE, BOB, ISSUER, clients, deployContracts, integrationAvailable, openTestDb, startAnvil } from "./harness";

const E18 = 10n ** 18n;
const START = 1_900_000_000n; // fixed future timestamp; tests warp the chain to it
const HEADER = "allocation_id,beneficiary,token_address,expected_amount,start_timestamp,cliff_seconds,duration_seconds";

describe.skipIf(!integrationAvailable)("issuer → vesting → claim → index → reconcile (Anvil + Postgres)", () => {
  let anvil: ChildProcess;
  let db: Db;
  let closeDb: () => Promise<void>;
  let token: Address;
  let registry: Address;
  let deployBlock: bigint;
  let deps: IndexerDeps;
  const { publicClient, wallet, testClient } = clients();

  const eventCount = async () =>
    (await db.select({ n: count() }).from(indexedEvents).where(eq(indexedEvents.contractAddress, registry.toLowerCase())))[0].n;

  async function create(id: string, beneficiary: Address, amount: bigint, cliff = 0n, duration = 1000n) {
    const hash = await wallet(ISSUER).writeContract({
      address: registry,
      abi: vestingRegistryAbi,
      functionName: "createSchedule",
      args: [encodeAllocationId(id), beneficiary, amount, START, cliff, duration],
    });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");
  }

  beforeAll(async () => {
    anvil = await startAnvil();
    ({ db, close: closeDb } = await openTestDb());
    ({ token, registry, deployBlock } = await deployContracts());
    deps = { db, client: publicClient, chainId: 31337, registry, deployBlock };

    const issuer = wallet(ISSUER);
    for (const [functionName, args] of [
      ["mint", [ISSUER, 1_000_000n * E18]],
      ["approve", [registry, 2n ** 256n - 1n]],
    ] as const) {
      const hash = await issuer.writeContract({
        address: token,
        abi: [
          ...erc20Abi,
          {
            type: "function",
            name: "mint",
            stateMutability: "nonpayable",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [],
          },
        ],
        functionName,
        args: args as never,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  });

  afterAll(async () => {
    await closeDb?.();
    anvil?.kill();
  });

  it("indexes creation, claims, and reconciles a CSV against the indexed block", async () => {
    await create("team-001", ALICE, 1000n * E18);
    await create("advisor-001", BOB, 250n * E18, 100n);

    // Warp to the midpoint and claim as the beneficiary.
    await testClient.setNextBlockTimestamp({ timestamp: START + 500n });
    await testClient.mine({ blocks: 1 });
    const claimHash = await wallet(ALICE).writeContract({
      address: registry,
      abi: vestingRegistryAbi,
      functionName: "release",
      args: [encodeAllocationId("team-001")],
    });
    const claim = await publicClient.waitForTransactionReceipt({ hash: claimHash });
    expect(claim.status).toBe("success");

    // Another account cannot claim Alice's allocation (the UI simulates before sending, as here).
    await expect(
      publicClient.simulateContract({
        account: BOB,
        address: registry,
        abi: vestingRegistryAbi,
        functionName: "release",
        args: [encodeAllocationId("team-001")],
      }),
    ).rejects.toThrow(/NotBeneficiary/);

    const results = await indexToHead(deps);
    expect(results.at(-1)!.caughtUp).toBe(true);
    expect(await eventCount()).toBe(5); // 2x Created, 2x Funded, 1x Released

    const rows = await db.select().from(allocations).where(eq(allocations.contractAddress, registry.toLowerCase()));
    const team = rows.find((r) => r.allocationId === "team-001")!;
    const onchain = await publicClient.readContract({
      address: registry,
      abi: vestingRegistryAbi,
      functionName: "getSchedule",
      args: [encodeAllocationId("team-001")],
    });
    expect(BigInt(team.releasedAmount)).toBe(onchain.released);
    expect(onchain.released).toBeGreaterThan(0n);

    const deployment: Deployment = { chainId: 31337, registry, token, admin: ISSUER, deployBlock };
    const head = await publicClient.getBlockNumber();
    const csv = [
      HEADER,
      `team-001,${ALICE},${token},1000,${START},0,1000`,
      `advisor-001,${BOB},${token},300,${START},100,1000`,
      `missing-001,${BOB},${token},1,${START},0,1000`,
    ].join("\n");
    const result = await runAndSaveReconciliation({
      db,
      deployment,
      tokenDecimals: 18,
      headBlock: head,
      csvText: csv,
      sourceFilename: "flow.csv",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.report.meta.stale).toBe(false);
    expect(result.report.meta.indexedBlock).toBe(head);
    const byId = Object.fromEntries(result.report.rows.map((r) => [r.allocationId, r.status]));
    expect(byId).toEqual({ "team-001": "matched", "advisor-001": "amount_mismatch", "missing-001": "missing_onchain" });

    // Saved report round-trips and exports with exact values and context.
    const saved = await loadReport(db, result.id);
    expect(saved?.rows.map((r) => r.status)).toEqual(result.report.rows.map((r) => r.status));
    const exported = reportToCsv(saved!);
    expect(exported).toContain(`# contract=${registry}`);
    expect(exported).toContain(`indexed_block=${head}`);
    expect(exported).toContain(`,advisor-001,${BOB},300000000000000000000,250000000000000000000,amount_mismatch,`);
  });

  it("marks the report stale and rows as pending when the chain moves ahead of the indexer", async () => {
    await create("late-001", ALICE, 5n * E18);
    const head = await publicClient.getBlockNumber();
    const result = await runAndSaveReconciliation({
      db,
      deployment: { chainId: 31337, registry, token, admin: ISSUER, deployBlock },
      tokenDecimals: 18,
      headBlock: head,
      csvText: [HEADER, `late-001,${ALICE},${token},5,${START},0,1000`].join("\n"),
      sourceFilename: null,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.report.meta.stale).toBe(true);
    expect(result.report.rows[0].status).toBe("pending_indexing");

    await indexToHead(deps);
    const again = await runAndSaveReconciliation({
      db,
      deployment: { chainId: 31337, registry, token, admin: ISSUER, deployBlock },
      tokenDecimals: 18,
      headBlock: await publicClient.getBlockNumber(),
      csvText: [HEADER, `late-001,${ALICE},${token},5,${START},0,1000`].join("\n"),
      sourceFilename: null,
    });
    if (!again.ok) throw new Error("expected ok");
    expect(again.report.rows.find((r) => r.allocationId === "late-001")?.status).toBe("matched");
  });

  it("replays already-processed blocks without duplicating events or projections", async () => {
    const before = await eventCount();
    const releasedBefore = (await db.select().from(allocations)).map((r) => [r.allocationId, r.releasedAmount]).sort();

    // Rewind the cursor to before the deployment and replay everything.
    await db.delete(indexerCursors).where(eq(indexerCursors.contractAddress, registry.toLowerCase()));
    const results = await indexToHead({ ...deps, batchSize: 2n });
    expect(results.length).toBeGreaterThan(1);
    expect(results.reduce((s, r) => s + r.eventsInserted, 0)).toBe(0);
    expect(await eventCount()).toBe(before);
    const releasedAfter = (await db.select().from(allocations)).map((r) => [r.allocationId, r.releasedAmount]).sort();
    expect(releasedAfter).toEqual(releasedBefore);
  });

  it("leaves no partial writes when a batch fails, and succeeds on retry", async () => {
    await create("retry-001", BOB, 3n * E18);
    const cursorBefore = await getCursor(db, deps);
    const eventsBefore = await eventCount();

    let failures = 1;
    const flaky: IndexerDeps["client"] = {
      getBlockNumber: (args) => publicClient.getBlockNumber(args),
      getContractEvents: publicClient.getContractEvents.bind(publicClient) as never,
      getBlock: (async (args: Parameters<typeof publicClient.getBlock>[0]) => {
        // Fail after logs were fetched, while resolving the batch's last block hash.
        if (args?.blockNumber !== cursorBefore!.lastProcessedBlock && failures-- > 0) {
          throw new Error("ECONNRESET (simulated transient RPC failure)");
        }
        return publicClient.getBlock(args);
      }) as never,
    };

    await expect(indexBatch({ ...deps, client: flaky })).rejects.toThrow(/simulated/);
    expect(await eventCount()).toBe(eventsBefore);
    expect((await getCursor(db, deps))!.lastProcessedBlock).toBe(cursorBefore!.lastProcessedBlock);

    failures = 1;
    let retries = 0;
    await withRetry(() => indexToHead({ ...deps, client: flaky }), { baseDelayMs: 1, onRetry: () => retries++ });
    expect(retries).toBe(1);
    expect(await eventCount()).toBe(eventsBefore + 2);
  });

  it("catches up from a restart in small batches", async () => {
    await create("batch-001", ALICE, E18);
    await create("batch-002", ALICE, E18);
    await testClient.mine({ blocks: 5 });
    const results = await indexToHead({ ...deps, batchSize: 1n });
    expect(results.length).toBeGreaterThanOrEqual(7);
    expect((await getCursor(db, deps))!.lastProcessedBlock).toBe(await publicClient.getBlockNumber());
    const ids = (
      await db
        .select({ id: allocations.allocationId })
        .from(allocations)
        .where(and(eq(allocations.contractAddress, registry.toLowerCase())))
    ).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["batch-001", "batch-002"]));
  });

  it("refuses to continue when the chain no longer matches the cursor, until reset", async () => {
    await db
      .update(indexerCursors)
      .set({ lastProcessedBlockHash: "0xdeadbeef" })
      .where(eq(indexerCursors.contractAddress, registry.toLowerCase()));
    await expect(indexBatch(deps)).rejects.toBeInstanceOf(ChainMismatchError);
    // Not retried: a reset is an operator decision.
    let retries = 0;
    await expect(withRetry(() => indexBatch(deps), { baseDelayMs: 1, onRetry: () => retries++ })).rejects.toBeInstanceOf(
      ChainMismatchError,
    );
    expect(retries).toBe(0);

    const before = await eventCount();
    await resetIndex(db, deps);
    expect(await eventCount()).toBe(0);
    await indexToHead(deps);
    expect(await eventCount()).toBe(before);
  });
});
