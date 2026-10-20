"use client";

import { useMemo } from "react";
import { useBlock, useConnection } from "wagmi";
import { sumReads, useReleasable, useVested } from "@/components/AllocationsTable";
import { ClaimButton } from "@/components/ClaimButton";
import { StaleIndexWarning } from "@/components/IndexingStatus";
import { useAppConfig } from "@/components/Providers";
import { Hex, Notice } from "@/components/ui";
import { RequireLocalWallet } from "@/components/WalletPanel";
import { useActivity, useAllocations, type IndexedAllocationDto } from "@/hooks/useIndexedData";
import { formatTokenAmount } from "@/lib/amounts";
import { scheduleState } from "@/lib/schedule";
import { DAY_SECONDS, daysUntil, utcDate, vestedAt } from "@/lib/unlocks";

const panel = "rounded-xl border border-[var(--border)] bg-[var(--surface)]";
const muted = "text-slate-600 dark:text-slate-400";

export default function MyAllocationsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My allocations</h1>
        <p className={`mt-1 text-sm ${muted}`}>Vesting schedules that pay the connected wallet.</p>
      </div>
      <RequireLocalWallet purpose="see and claim allocations paid to it">
        <RecipientView />
      </RequireLocalWallet>
    </div>
  );
}

interface Row {
  a: IndexedAllocationDto;
  releasable: bigint | undefined;
  vested: bigint | undefined;
}

function RecipientView() {
  const { address } = useConnection();
  const { registry } = useAppConfig();
  const { data, error, isLoading } = useAllocations(address);
  const allocations = useMemo(() => data?.allocations ?? [], [data]);
  const releasable = useReleasable(allocations);
  const { data: block } = useBlock({ watch: true });
  const vested = useVested(allocations, block?.timestamp);

  if (isLoading) return <p className="text-sm text-slate-500">Loading your allocations…</p>;
  if (error || !data) return <Notice tone="bad">{(error as Error)?.message}</Notice>;

  const decimals = data.meta.tokenDecimals ?? 18;
  const symbol = data.meta.tokenSymbol ?? "";
  const fmt = (v: bigint | undefined) => (v === undefined ? "…" : formatTokenAmount(v, decimals));
  const read = (r: { status: string; result?: unknown } | undefined) => (r?.status === "success" ? (r.result as bigint) : undefined);
  const rows: Row[] = allocations.map((a, i) => ({ a, releasable: read(releasable.data?.[i]), vested: read(vested.data?.[i]) }));

  if (rows.length === 0) {
    return (
      <>
        <StaleIndexWarning meta={data.meta} />
        <section className={`${panel} px-6 py-12 text-center`}>
          <h2 className="text-lg font-semibold">No allocations pay this wallet</h2>
          <p className={`mx-auto mt-2 max-w-lg text-sm ${muted}`}>
            Nothing indexed for <span className="font-mono">{address}</span> as of block {data.meta.indexedBlock ?? "—"}.
            After running the seed script, try Anvil #1 or #2.
          </p>
        </section>
      </>
    );
  }

  const totalAllocated = rows.reduce((s, r) => s + BigInt(r.a.totalAmount), 0n);
  const totalClaimable = sumReads(releasable.data, rows.length);
  const totalVested = sumReads(vested.data, rows.length);
  const totalClaimed = rows.reduce((s, r) => s + BigInt(r.a.releasedAmount), 0n);
  const best = rows.reduce((b, r) => ((r.releasable ?? 0n) > (b.releasable ?? 0n) ? r : b), rows[0]);
  const othersClaimable = rows.filter((r) => r !== best && (r.releasable ?? 0n) > 0n).length;
  const now = block?.timestamp;

  return (
    <>
      <StaleIndexWarning meta={data.meta} />

      <div className="flex flex-wrap items-stretch gap-5">
        <section aria-label="Claimable now" className={`${panel} flex min-w-0 flex-[2_1_460px] flex-col gap-3.5 p-6`}>
          <p className={`text-[13px] ${muted}`}>Claimable now</p>
          <p className="flex flex-wrap items-baseline gap-2.5">
            <span className="break-all font-mono text-4xl font-medium tracking-tight tabular-nums sm:text-5xl">
              {fmt(totalClaimable)}
            </span>
            <span className={`font-mono text-lg ${muted}`}>{symbol}</span>
          </p>
          <p className={`text-xs ${muted}`}>
            Read from the contract (<span className="font-mono">releasable()</span>)
            {block ? ` at block ${block.number}` : ""}. More vests every block.
          </p>
          <div className="flex flex-col gap-2">
            <ClaimButton
              registry={registry}
              allocationIdHex={best.a.allocationIdHex}
              beneficiary={best.a.beneficiary}
              releasable={best.releasable}
              size="lg"
              align="start"
              label={(best.releasable ?? 0n) > 0n ? `Claim ${fmt(best.releasable)} ${symbol}` : "Nothing to claim yet"}
            />
            {(best.releasable ?? 0n) > 0n && (
              <p className={`text-[13px] ${muted}`}>
                From <span className="font-mono">{best.a.allocationId}</span> · one transaction
                {othersClaimable > 0 &&
                  ` · ${othersClaimable} more ${othersClaimable === 1 ? "schedule has" : "schedules have"} claimable tokens below`}
              </p>
            )}
          </div>
        </section>

        <NextUnlock rows={rows} now={now} fmt={fmt} symbol={symbol} />
      </div>

      <section
        aria-label="Totals"
        className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)]"
      >
        {[
          ["Allocated to you", fmt(totalAllocated)],
          ["Vested", fmt(totalVested)],
          ["Claimed", fmt(totalClaimed)],
          ["Still locked", fmt(totalVested === undefined ? undefined : totalAllocated - totalVested)],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--surface)] px-4 py-3.5">
            <p className={`text-xs ${muted}`}>{label}</p>
            <p className="mt-1 break-all font-mono tabular-nums">
              {value} {symbol}
            </p>
          </div>
        ))}
      </section>

      <section aria-label="Schedules" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Schedules · {rows.length}</h2>
        {rows.map((r) => (
          <ScheduleCard key={r.a.allocationIdHex} row={r} now={now} fmt={fmt} symbol={symbol} registry={registry} />
        ))}
      </section>

      <ClaimHistory address={address!} decimals={decimals} symbol={symbol} />
    </>
  );
}

function NextUnlock({
  rows,
  now,
  fmt,
  symbol,
}: {
  rows: Row[];
  now: bigint | undefined;
  fmt: (v: bigint | undefined) => string;
  symbol: string;
}) {
  let body: React.ReactNode = <p className="text-sm text-slate-500">Reading chain time…</p>;
  if (now !== undefined) {
    const terms = rows.map((r) => ({
      id: r.a.allocationId,
      totalAmount: BigInt(r.a.totalAmount),
      start: BigInt(r.a.start),
      cliffDuration: BigInt(r.a.cliffDuration),
      duration: BigInt(r.a.duration),
    }));
    const upcoming = terms
      .filter((t) => t.cliffDuration > 0n && t.start + t.cliffDuration > now)
      .sort((x, y) => Number(x.start + x.cliffDuration - (y.start + y.cliffDuration)))[0];
    const vesting = terms.filter((t) => now >= t.start + t.cliffDuration && now < t.start + t.duration);
    if (upcoming) {
      const at = upcoming.start + upcoming.cliffDuration;
      body = (
        <>
          <p className="break-all font-mono text-xl font-medium">
            ≈{fmt(vestedAt(upcoming, at))} {symbol}
          </p>
          <p>
            {utcDate(at)}, when the <span className="font-mono">{upcoming.id}</span> cliff ends
          </p>
          <p className={`text-[13px] ${muted}`}>In {daysUntil(at, now)} days, by chain time</p>
        </>
      );
    } else if (vesting.length > 0) {
      const perDay = vesting.reduce((s, t) => s + (t.totalAmount * DAY_SECONDS) / t.duration, 0n);
      const end = vesting.reduce((m, t) => (t.start + t.duration > m ? t.start + t.duration : m), 0n);
      body = (
        <>
          <p className="break-all font-mono text-xl font-medium">
            ≈{fmt(perDay)} {symbol} / day
          </p>
          <p>
            Vesting continuously across {vesting.length} {vesting.length === 1 ? "schedule" : "schedules"}
          </p>
          <p className={`text-[13px] ${muted}`}>Until {utcDate(end)}, by chain time</p>
        </>
      );
    } else {
      body = <p>Everything allocated to you has vested.</p>;
    }
  }
  return (
    <section aria-label="Next unlock" className={`${panel} flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 p-6`}>
      <p className={`text-[13px] ${muted}`}>Next unlock</p>
      {body}
    </section>
  );
}

const pctOf = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 10_000n) / whole) / 100);

function ScheduleCard({
  row,
  now,
  fmt,
  symbol,
  registry,
}: {
  row: Row;
  now: bigint | undefined;
  fmt: (v: bigint | undefined) => string;
  symbol: string;
  registry: `0x${string}`;
}) {
  const { a, releasable, vested } = row;
  const total = BigInt(a.totalAmount);
  const start = BigInt(a.start);
  const cliff = BigInt(a.cliffDuration);
  const duration = BigInt(a.duration);
  const claimed = BigInt(a.releasedAmount);
  const locked = vested !== undefined ? total - vested : undefined;

  const state = now !== undefined ? scheduleState({ start, cliffDuration: cliff, duration, totalAmount: total, released: claimed }, now) : null;
  const tag =
    state === "not_started"
      ? { text: `Starts in ${daysUntil(start, now!)} days`, cls: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300" }
      : state === "cliff"
        ? {
            text: `Before cliff · ${daysUntil(start + cliff, now!)} days left`,
            cls: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
          }
        : state === "vesting"
          ? { text: "Vesting", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" }
          : state === "fully_vested"
            ? { text: "Fully vested", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300" }
            : state === "completed"
              ? { text: "Completed", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" }
              : null;

  const claimedPct = pctOf(claimed, total);
  const claimablePct = releasable === undefined ? 0 : pctOf(releasable, total);
  const cliffPct = pctOf(cliff, duration);
  const todayPct = now === undefined ? null : Math.min(100, Math.max(0, pctOf(now > start ? now - start : 0n, duration)));
  const summary = `${a.allocationId}: ${claimedPct}% claimed, ${claimablePct}% claimable, ${Math.max(0, 100 - claimedPct - claimablePct).toFixed(2)}% locked${cliff > 0n ? `; cliff at ${cliffPct}% of the schedule` : ""}.`;

  return (
    <article className={`${panel} flex flex-col gap-3.5 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="font-mono text-[17px] font-medium">{a.allocationId}</h3>
          {tag && <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tag.cls}`}>{tag.text}</span>}
        </div>
        <span className="font-mono text-sm tabular-nums">
          {fmt(total)} {symbol}
        </span>
      </div>

      <div className="relative pt-5">
        <div role="img" aria-label={summary} className="flex h-3 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <span className="bg-emerald-700" style={{ width: `${claimedPct}%` }} />
          <span className="bg-blue-600" style={{ width: `${claimablePct}%` }} />
        </div>
        {cliff > 0n && (
          <>
            <span aria-hidden="true" className="absolute top-3.5 h-6 w-0.5 bg-slate-900 dark:bg-slate-100" style={{ left: `${cliffPct}%` }} />
            <span
              aria-hidden="true"
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] text-slate-700 dark:text-slate-300"
              style={{ left: `${cliffPct}%` }}
            >
              cliff
            </span>
          </>
        )}
        {todayPct !== null && todayPct > 0 && todayPct < 100 && (
          <span
            aria-hidden="true"
            className="absolute top-4 h-5 border-l-2 border-dashed border-slate-400"
            style={{ left: `${todayPct}%` }}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-700 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-700" aria-hidden="true" />
          Claimed {fmt(claimed)} {symbol}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-blue-600" aria-hidden="true" />
          Claimable {fmt(releasable)} {symbol}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-stone-300 bg-stone-200 dark:border-stone-600 dark:bg-stone-800" aria-hidden="true" />
          Locked {fmt(locked)} {symbol}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 border-l-2 border-dashed border-slate-400" aria-hidden="true" />
          Today
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-5 gap-y-2 text-[13px]">
          <div>
            <dt className={muted}>Start</dt>
            <dd className="font-mono">{utcDate(start)}</dd>
          </div>
          <div>
            <dt className={muted}>Cliff ends</dt>
            <dd className="font-mono">{cliff > 0n ? utcDate(start + cliff) : "no cliff"}</dd>
          </div>
          <div>
            <dt className={muted}>Fully vested</dt>
            <dd className="font-mono">{utcDate(start + duration)}</dd>
          </div>
          <div>
            <dt className={muted}>Vests per day{cliff > 0n ? " after cliff" : ""}</dt>
            <dd className="font-mono">
              ≈{fmt((total * DAY_SECONDS) / duration)} {symbol}
            </dd>
          </div>
        </dl>
        {state !== "completed" && (
          <ClaimButton registry={registry} allocationIdHex={a.allocationIdHex} beneficiary={a.beneficiary} releasable={releasable} />
        )}
      </div>
    </article>
  );
}

function ClaimHistory({ address, decimals, symbol }: { address: string; decimals: number; symbol: string }) {
  const { data, isLoading } = useActivity(50, address);
  const claims = (data?.events ?? []).filter((e) => e.eventName === "TokensReleased");
  return (
    <section aria-label="Claim history" className={`${panel} overflow-hidden`}>
      <h2 className="border-b border-[var(--border)] px-4 py-3.5 text-sm font-semibold">Claim history</h2>
      {isLoading ? (
        <p className="px-4 py-6 text-sm text-slate-500">Loading…</p>
      ) : claims.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">No claims indexed yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[600px] text-[13px]">
            {claims.map((e) => (
              <div
                key={e.id}
                className="grid grid-cols-[150px_1fr_110px_140px] items-center gap-x-4 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800"
              >
                <span className="font-mono">{e.allocationId}</span>
                <span className="font-mono tabular-nums">
                  {formatTokenAmount(e.payload.amount, decimals)} {symbol}
                </span>
                <span className={`font-mono ${muted}`}>block {e.blockNumber}</span>
                <Hex value={e.transactionHash} chars={4} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
