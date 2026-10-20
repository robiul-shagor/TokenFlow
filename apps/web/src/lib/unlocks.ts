/**
 * Display-only vesting projections (unlock chart, schedule previews). They mirror
 * `VestingRegistry._vested` with the same integer math, but claimable amounts shown as facts always
 * come from the contract's `releasable` / `vestedAmount` views, never from here.
 */

export interface VestingTerms {
  allocationId: string;
  totalAmount: bigint;
  start: bigint;
  cliffDuration: bigint;
  duration: bigint;
}

export const DAY_SECONDS = 86_400n;

/** Amount vested at unix time `t` (seconds). Same rounding as the contract (floor). */
export function vestedAt(s: Omit<VestingTerms, "allocationId">, t: bigint): bigint {
  if (t < s.start + s.cliffDuration) return 0n;
  if (t >= s.start + s.duration) return s.totalAmount;
  return (s.totalAmount * (t - s.start)) / s.duration;
}

export interface UnlockBucket {
  /** Short UTC month label; January carries the year ("Jan 27"). */
  label: string;
  from: bigint;
  to: bigint;
  amount: bigint;
  /** Allocations whose cliff ends inside this bucket. */
  cliffEnds: string[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthStartUtc(year: number, month: number): bigint {
  return BigInt(Date.UTC(year, month, 1) / 1000);
}

/**
 * Tokens that become vested in each UTC calendar month, starting with the rest of the current month
 * (from `now`) and covering `months` buckets in total.
 */
export function monthlyUnlocks(schedules: VestingTerms[], now: bigint, months = 12): UnlockBucket[] {
  const d = new Date(Number(now) * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const buckets: UnlockBucket[] = [];
  for (let i = 0; i < months; i++) {
    const from = i === 0 ? now : monthStartUtc(y, m + i);
    const to = monthStartUtc(y, m + i + 1);
    const monthIndex = (m + i) % 12;
    const year = new Date(Number(from) * 1000).getUTCFullYear();
    let amount = 0n;
    const cliffEnds: string[] = [];
    for (const s of schedules) {
      amount += vestedAt(s, to - 1n) - vestedAt(s, from - 1n);
      const cliffEnd = s.start + s.cliffDuration;
      if (s.cliffDuration > 0n && cliffEnd >= from && cliffEnd < to) cliffEnds.push(s.allocationId);
    }
    buckets.push({
      label: monthIndex === 0 ? `Jan ${String(year).slice(2)}` : MONTHS[monthIndex],
      from,
      to,
      amount,
      cliffEnds,
    });
  }
  return buckets;
}

/**
 * The bucket worth warning about: a month whose unlock includes cliff ends and is at least twice the
 * average of the other months. Returns null when unlocks are spread evenly.
 */
export function findUnlockSpike(buckets: UnlockBucket[]): UnlockBucket | null {
  if (buckets.length < 2) return null;
  const max = buckets.reduce((a, b) => (b.amount > a.amount ? b : a));
  if (max.amount === 0n || max.cliffEnds.length === 0) return null;
  const others = buckets.filter((b) => b !== max).reduce((s, b) => s + b.amount, 0n);
  const othersAvg = others / BigInt(buckets.length - 1);
  return max.amount >= othersAvg * 2n ? max : null;
}

/** `YYYY-MM-DD` (UTC) for a unix timestamp in seconds. */
export function utcDate(t: bigint): string {
  return new Date(Number(t) * 1000).toISOString().slice(0, 10);
}

/** Whole days from `now` until `t`, rounded up; 0 if `t` has passed. */
export function daysUntil(t: bigint, now: bigint): number {
  if (t <= now) return 0;
  return Number((t - now + DAY_SECONDS - 1n) / DAY_SECONDS);
}
