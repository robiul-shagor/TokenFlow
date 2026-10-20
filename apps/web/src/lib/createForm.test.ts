import { describe, expect, it } from "vitest";
import { validateCreateForm } from "./createForm";

const valid = {
  allocationId: "team-002",
  beneficiary: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  amount: "1000.25",
  start: "2026-01-01T00:00",
  cliffDays: "30",
  durationDays: "365",
};

describe("validateCreateForm", () => {
  it("produces exact contract arguments", () => {
    const r = validateCreateForm(valid, 18);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args.beneficiary).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(r.args.amountRaw).toBe(100025n * 10n ** 16n);
    expect(r.args.cliffDuration).toBe(30n * 86400n);
    expect(r.args.duration).toBe(365n * 86400n);
  });

  it("interprets the start as UTC regardless of the browser time zone", () => {
    const r = validateCreateForm(valid, 18);
    expect(r.ok && r.args.start).toBe(1767225600n); // 2026-01-01T00:00:00Z
  });

  it("reports every invalid field", () => {
    const r = validateCreateForm(
      { allocationId: "bad id", beneficiary: "0x0000000000000000000000000000000000000000", amount: "0", start: "", cliffDays: "400", durationDays: "365" },
      18,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["allocationId", "amount", "beneficiary", "cliffDays", "start"]);
  });

  it("rejects fractional days, zero duration and over-precise amounts", () => {
    const r = validateCreateForm({ ...valid, cliffDays: "1.5", durationDays: "0", amount: "1.1234567" }, 6);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.cliffDays).toBeDefined();
    expect(r.errors.durationDays).toBeDefined();
    expect(r.errors.amount).toMatch(/decimal places/);
  });
});
