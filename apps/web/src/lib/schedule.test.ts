import { describe, expect, it } from "vitest";
import { scheduleState } from "./schedule";

const s = { start: 100n, cliffDuration: 10n, duration: 100n, totalAmount: 1000n, released: 0n };

describe("scheduleState", () => {
  it.each([
    [99n, "not_started"],
    [100n, "cliff"],
    [109n, "cliff"],
    [110n, "vesting"],
    [199n, "vesting"],
    [200n, "fully_vested"],
  ] as const)("at %s is %s", (now, expected) => {
    expect(scheduleState(s, now)).toBe(expected);
  });

  it("is completed once everything is released", () => {
    expect(scheduleState({ ...s, released: 1000n }, 500n)).toBe("completed");
  });
});
