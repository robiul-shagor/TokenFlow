import { formatUnits } from "viem";

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Strictly convert a human-readable decimal string (e.g. "1250.5") into raw integer token units.
 * Unlike viem's `parseUnits`, this never rounds: more fractional digits than `decimals` is an error.
 * Throws on negatives, exponents, separators, whitespace-only and empty input.
 */
export function parseTokenAmount(input: string, decimals: number): bigint {
  const value = input.trim();
  const match = DECIMAL_RE.exec(value);
  if (!match) throw new Error(`"${input}" is not a non-negative decimal number`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new Error(`"${input}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Display-only formatting of raw token units. Never feed the result back into arithmetic. */
export function formatTokenAmount(raw: bigint | string, decimals: number, maxFractionDigits = 4): string {
  const formatted = formatUnits(BigInt(raw), decimals);
  const [whole, fraction] = formatted.split(".");
  const wholeWithSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!fraction) return wholeWithSeparators;
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${wholeWithSeparators}.${trimmed}` : wholeWithSeparators;
}

/** Short display label for chart axes ("2.66M", "458k", "12.5"). Never used for comparisons. */
export function formatCompactTokenAmount(raw: bigint | string, decimals: number): string {
  const tokens = Number(formatUnits(BigInt(raw), decimals));
  if (tokens === 0) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(tokens).replace("K", "k");
}
