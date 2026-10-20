import { describe, expect, it } from "vitest";
import { decodeAllocationId, encodeAllocationId, isValidAllocationId } from "./allocationId";

describe("allocation ids", () => {
  it("round-trips through bytes32", () => {
    const hex = encodeAllocationId("team-001");
    expect(hex).toHaveLength(66);
    expect(decodeAllocationId(hex)).toBe("team-001");
  });

  it("matches Solidity bytes32(\"team-001\") encoding", () => {
    expect(encodeAllocationId("team-001")).toBe(
      "0x7465616d2d303031000000000000000000000000000000000000000000000000",
    );
  });

  it("validates format", () => {
    expect(isValidAllocationId("a".repeat(31))).toBe(true);
    expect(isValidAllocationId("a".repeat(32))).toBe(false);
    expect(isValidAllocationId("")).toBe(false);
    expect(isValidAllocationId("has space")).toBe(false);
    expect(() => encodeAllocationId("bad id")).toThrow();
  });

  it("falls back to hex for non-printable ids", () => {
    const raw = "0xff00000000000000000000000000000000000000000000000000000000000000";
    expect(decodeAllocationId(raw)).toBe(raw);
  });
});
