import { describe, expect, it } from "vitest";
import { DAY_SECONDS, daysUntil, findUnlockSpike, monthlyUnlocks, utcDate, vestedAt } from "./unlocks";

const ts = (iso: string) => BigInt(Date.parse(iso) / 1000);

describe("vestedAt", () => {
  const s = { totalAmount: 1000n, start: 100n, cliffDuration: 50n, duration: 400n };
  it("mirrors the contract: nothing before the cliff, linear after, full at the end", () => {
    expect(vestedAt(s, 149n)).toBe(0n);
    expect(vestedAt(s, 150n)).toBe(125n);
    expect(vestedAt(s, 301n)).toBe(502n); // floor(1000 * 201 / 400)
    expect(vestedAt(s, 500n)).toBe(1000n);
    expect(vestedAt(s, 10_000n)).toBe(1000n);
  });
});

describe("monthlyUnlocks", () => {
  const now = ts("2026-10-20T00:00:00Z");

  it("buckets by UTC month starting with the rest of the current month", () => {
    const b = monthlyUnlocks([], now, 4);
    expect(b.map((x) => x.label)).toEqual(["Oct", "Nov", "Dec", "Jan 27"]);
    expect(b[0].from).toBe(now);
    expect(b[1].from).toBe(ts("2026-11-01T00:00:00Z"));
  });

  it("sums to the amount that vests over the window and flags cliff ends", () => {
    const cliffy = {
      allocationId: "team-1",
      totalAmount: 365n * 1000n,
      start: ts("2026-01-01T00:00:00Z"),
      cliffDuration: 365n * DAY_SECONDS,
      duration: 730n * DAY_SECONDS,
    };
    const b = monthlyUnlocks([cliffy], now, 12);
    const total = b.reduce((s, x) => s + x.amount, 0n);
    expect(total).toBe(vestedAt(cliffy, b.at(-1)!.to - 1n) - vestedAt(cliffy, now - 1n));
    expect(b[3].label).toBe("Jan 27");
    expect(b[3].cliffEnds).toEqual(["team-1"]);
    expect(b[0].amount).toBe(0n);
    expect(findUnlockSpike(b)).toBe(b[3]);
  });

  it("reports no spike for a steady linear schedule", () => {
    const linear = { allocationId: "x", totalAmount: 10n ** 24n, start: now - 10n, cliffDuration: 0n, duration: 3650n * DAY_SECONDS };
    expect(findUnlockSpike(monthlyUnlocks([linear], now, 12))).toBeNull();
  });
});

describe("date helpers", () => {
  it("formats UTC dates and counts days up", () => {
    expect(utcDate(ts("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
    expect(daysUntil(100n + DAY_SECONDS + 1n, 100n)).toBe(2);
    expect(daysUntil(50n, 100n)).toBe(0);
  });
});
