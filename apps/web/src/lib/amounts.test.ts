import { describe, expect, it } from "vitest";
import { formatCompactTokenAmount, formatTokenAmount, parseTokenAmount } from "./amounts";

describe("parseTokenAmount", () => {
  it("converts decimals exactly", () => {
    expect(parseTokenAmount("1", 18)).toBe(10n ** 18n);
    expect(parseTokenAmount("1250.5", 18)).toBe(1250n * 10n ** 18n + 5n * 10n ** 17n);
    expect(parseTokenAmount("0.000000000000000001", 18)).toBe(1n);
    expect(parseTokenAmount(" 42 ", 0)).toBe(42n);
  });

  it("handles very large values without precision loss", () => {
    const big = "123456789012345678901234567890.123456789012345678";
    expect(parseTokenAmount(big, 18)).toBe(123456789012345678901234567890123456789012345678n);
  });

  it.each(["", "-1", "1e18", "1,000", "0x10", "1.", ".5", "abc", "1.2.3", "NaN"])("rejects %j", (input) => {
    expect(() => parseTokenAmount(input, 18)).toThrow();
  });

  it("rejects more fractional digits than the token supports instead of rounding", () => {
    expect(() => parseTokenAmount("1.1234567", 6)).toThrow(/more than 6 decimal places/);
  });
});

describe("formatTokenAmount", () => {
  it("formats for display with separators and trimmed fraction", () => {
    expect(formatTokenAmount(1234567n * 10n ** 18n, 18)).toBe("1,234,567");
    expect(formatTokenAmount(15n * 10n ** 17n, 18)).toBe("1.5");
    expect(formatTokenAmount("1", 18)).toBe("0");
    expect(formatTokenAmount(123456789n, 6, 6)).toBe("123.456789");
  });
});

describe("formatCompactTokenAmount", () => {
  it("abbreviates for chart labels", () => {
    expect(formatCompactTokenAmount(2_658_000n * 10n ** 18n, 18)).toBe("2.66M");
    expect(formatCompactTokenAmount(458_000n * 10n ** 18n, 18)).toBe("458k");
    expect(formatCompactTokenAmount(0n, 18)).toBe("0");
  });
});
