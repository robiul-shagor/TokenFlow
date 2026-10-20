import { describe, expect, it } from "vitest";
import { computeIndexerStatus } from "./health";

const now = new Date("2026-10-20T12:00:00Z");
const recent = new Date(now.getTime() - 1_000);

describe("computeIndexerStatus", () => {
  it("is synced when the cursor equals the head", () => {
    const s = computeIndexerStatus({ indexedBlock: 10n, headBlock: 10n, lastRunAt: recent, lastError: null, now });
    expect(s).toMatchObject({ state: "synced", stale: false, lagBlocks: 0n });
  });

  it("marks the indexer behind when the chain advances", () => {
    const s = computeIndexerStatus({ indexedBlock: 10n, headBlock: 13n, lastRunAt: recent, lastError: null, now });
    expect(s).toMatchObject({ state: "behind", stale: true, lagBlocks: 3n });
  });

  it("detects a stalled worker", () => {
    const old = new Date(now.getTime() - 120_000);
    const s = computeIndexerStatus({ indexedBlock: 10n, headBlock: 11n, lastRunAt: old, lastError: null, now });
    expect(s.state).toBe("stalled");
  });

  it("reports RPC unavailability and not-started as stale", () => {
    expect(computeIndexerStatus({ indexedBlock: 5n, headBlock: null, lastRunAt: recent, lastError: null, now })).toMatchObject({
      state: "rpc_unavailable",
      stale: true,
    });
    expect(computeIndexerStatus({ indexedBlock: null, headBlock: 5n, lastRunAt: null, lastError: null, now }).state).toBe(
      "not_started",
    );
  });

  it("surfaces the last error", () => {
    const s = computeIndexerStatus({ indexedBlock: 5n, headBlock: 5n, lastRunAt: recent, lastError: "boom", now });
    expect(s).toMatchObject({ state: "error", stale: true });
  });
});
