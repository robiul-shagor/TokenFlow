"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useBlock } from "wagmi";
import { ActivityFeed } from "@/components/ActivityFeed";
import { AllocationsTable, sumReads, useReleasable, useVested } from "@/components/AllocationsTable";
import { StaleIndexWarning } from "@/components/IndexingStatus";
import { ATTENTION, GROUP_OF, GROUP_ORDER, GROUPS, type Group } from "@/components/ReconciliationResult";
import { Hex, Notice } from "@/components/ui";
import { useAllocations, useReports, type IndexingMeta } from "@/hooks/useIndexedData";
import { formatCompactTokenAmount, formatTokenAmount } from "@/lib/amounts";
import type { ReconciliationStatus } from "@/lib/reconcile";
import { findUnlockSpike, monthlyUnlocks, type UnlockBucket } from "@/lib/unlocks";

const panel = "rounded-xl border border-[var(--border)] bg-[var(--surface)]";
const primaryBtn =
  "inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800";
const secondaryBtn =
  "inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800";

export default function OverviewPage() {
  const { data, error, isLoading } = useAllocations();
  const allocations = useMemo(() => data?.allocations ?? [], [data]);
  const releasable = useReleasable(allocations);
  const { data: block } = useBlock({ watch: true });
  const vested = useVested(allocations, block?.timestamp);

  const schedules = useMemo(
    () =>
      allocations.map((a) => ({
        allocationId: a.allocationId,
        totalAmount: BigInt(a.totalAmount),
        start: BigInt(a.start),
        cliffDuration: BigInt(a.cliffDuration),
        duration: BigInt(a.duration),
      })),
    [allocations],
  );
  const buckets = useMemo(() => (block ? monthlyUnlocks(schedules, block.timestamp) : null), [schedules, block]);
  const beneficiaries = useMemo(() => new Map(allocations.map((a) => [a.allocationId, a.beneficiary])), [allocations]);

  if (isLoading) return <p className="text-sm text-slate-500">Loading overview…</p>;
  if (error || !data) return <Notice tone="bad" title="Could not load indexed data">{(error as Error)?.message}</Notice>;

  const meta = data.meta;
  const decimals = meta.tokenDecimals ?? 18;
  const symbol = meta.tokenSymbol ?? "";
  const fmt = (v: bigint | undefined) => (v === undefined ? "…" : formatTokenAmount(v, decimals));
  const totalAllocated = allocations.reduce((s, a) => s + BigInt(a.totalAmount), 0n);
  const totalClaimed = allocations.reduce((s, a) => s + BigInt(a.releasedAmount), 0n);
  const totalVested = sumReads(vested.data, allocations.length);
  const totalClaimable = sumReads(releasable.data, allocations.length);
  const pct = (part: bigint | undefined, whole: bigint) =>
    part === undefined || whole === 0n ? null : `${(Number((part * 1000n) / whole) / 10).toFixed(1)}%`;
  const beneficiaryCount = new Set(allocations.map((a) => a.beneficiary)).size;

  const kpis: { label: string; source: "contract" | "index"; value: string; sub: string }[] = [
    {
      label: "Allocations",
      source: "index",
      value: String(allocations.length),
      sub: `${beneficiaryCount} ${beneficiaryCount === 1 ? "beneficiary" : "beneficiaries"}`,
    },
    { label: "Total allocated", source: "index", value: fmt(totalAllocated), sub: `${symbol} · funded at creation` },
    {
      label: "Vested so far",
      source: "contract",
      value: fmt(totalVested),
      sub: `${symbol}${pct(totalVested, totalAllocated) ? ` · ${pct(totalVested, totalAllocated)} of allocated` : ""}`,
    },
    {
      label: "Claimed",
      source: "index",
      value: fmt(totalClaimed),
      sub: `${symbol}${totalVested && pct(totalClaimed, totalVested) ? ` · ${pct(totalClaimed, totalVested)} of vested` : ""}`,
    },
    { label: "Claimable now", source: "contract", value: fmt(totalClaimable), sub: `${symbol} · vested, not yet claimed` },
    {
      label: "Last indexed block",
      source: "index",
      value: meta.indexedBlock ?? "—",
      sub: meta.indexer.stale ? meta.indexer.message : "in sync with head",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
            Vesting registry <Hex value={meta.registry} chars={4} kind="address" /> · token {symbol || "—"} · chain {meta.chainId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={secondaryBtn} href="/reconcile">
            Reconcile a CSV
          </Link>
          <Link className={primaryBtn} href="/allocations/new">
            New allocation
          </Link>
        </div>
      </div>

      <StaleIndexWarning meta={meta} />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className={`${panel} flex flex-col gap-1.5 px-4 py-4`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-400">{k.label}</span>
              <span
                className={`rounded px-1.5 font-mono text-[11px] ${
                  k.source === "contract"
                    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                }`}
                title={k.source === "contract" ? "Read live from the contract" : "From the indexed read model"}
              >
                {k.source}
              </span>
            </div>
            <span className="break-all font-mono text-xl font-medium tabular-nums">{k.value}</span>
            <span className="text-xs text-slate-600 dark:text-slate-400">{k.sub}</span>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-stretch gap-5">
        <UnlockChart buckets={buckets} decimals={decimals} symbol={symbol} />
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <IndexerCard meta={meta} />
          <LastReconciliationCard />
        </div>
      </div>

      <section aria-label="Allocations" className={`${panel} overflow-hidden`}>
        <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">Allocations · {allocations.length}</h2>
        <div className="px-4 py-2">
          <AllocationsTable allocations={allocations} decimals={decimals} symbol={symbol} />
        </div>
      </section>

      <section aria-label="Recent activity" className={`${panel} overflow-hidden`}>
        <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">Recent activity</h2>
        <ActivityFeed decimals={decimals} symbol={symbol} beneficiaries={beneficiaries} />
      </section>
    </div>
  );
}

function UnlockChart({ buckets, decimals, symbol }: { buckets: UnlockBucket[] | null; decimals: number; symbol: string }) {
  const max = buckets?.reduce((m, b) => (b.amount > m ? b.amount : m), 0n) ?? 0n;
  const spike = buckets ? findUnlockSpike(buckets) : null;
  const spikeMonth = spike
    ? new Date(Number(spike.from) * 1000).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : "";

  return (
    <section aria-label="Upcoming unlocks" className={`${panel} flex min-w-0 flex-[999_1_600px] flex-col gap-4 p-5`}>
      <div>
        <h2 className="text-sm font-semibold">Upcoming unlocks, next 12 months</h2>
        <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400">
          {symbol || "Tokens"} that vest each month (UTC), projected from indexed schedules at chain time
        </p>
      </div>
      {spike && (
        <div className="rounded-lg bg-orange-50 px-3.5 py-3 text-[13.5px] text-orange-950 dark:bg-orange-950/40 dark:text-orange-200">
          <strong>
            {spikeMonth}: about {formatCompactTokenAmount(spike.amount, decimals)} {symbol} vests
          </strong>{" "}
          as {spike.cliffEnds.length === 1 ? "a cliff ends" : `${spike.cliffEnds.length} cliffs end`} (
          <span className="font-mono">{spike.cliffEnds.join(", ")}</span>). Make sure the beneficiaries know.
        </div>
      )}
      {!buckets ? (
        <p className="text-sm text-slate-500">Reading chain time…</p>
      ) : max === 0n ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-slate-500">
          Nothing vests in the next 12 months.
        </p>
      ) : (
        <div>
          <div
            role="img"
            aria-label={`Monthly unlocks: ${buckets.map((b) => `${b.label} ${formatCompactTokenAmount(b.amount, decimals)}`).join(", ")}`}
            className="grid h-60 grid-cols-12 items-end gap-1.5 border-b border-slate-300 pt-2 sm:gap-2 dark:border-slate-700"
          >
            {buckets.map((b) => {
              const isSpike = b === spike;
              const h = b.amount === 0n ? 0 : Math.max(4, Number((b.amount * 200n) / max));
              return (
                <div key={b.label} className="flex h-full flex-col items-center justify-end gap-1">
                  <span
                    className={`font-mono text-[10px] sm:text-[11px] ${isSpike ? "font-semibold text-orange-800 dark:text-orange-300" : "hidden text-slate-500 sm:inline"}`}
                  >
                    {b.amount === 0n ? "" : formatCompactTokenAmount(b.amount, decimals)}
                  </span>
                  <span
                    className={`w-full max-w-11 rounded-t ${isSpike ? "bg-orange-500" : "bg-blue-300 dark:bg-blue-700"}`}
                    style={{ height: `${h}px` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 grid grid-cols-12 gap-1.5 sm:gap-2" aria-hidden="true">
            {buckets.map((b) => (
              <span key={b.label} className="text-center text-[11px] text-slate-600 dark:text-slate-400">
                {b.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function IndexerCard({ meta }: { meta: IndexingMeta }) {
  const ok = !meta.indexer.stale;
  return (
    <section aria-label="Indexer health" className={`${panel} flex flex-col gap-3 p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Indexer</h2>
        <span
          className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${ok ? "text-emerald-800 dark:text-emerald-300" : "text-orange-800 dark:text-orange-300"}`}
        >
          <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-600" : "bg-orange-500"}`} aria-hidden="true" />
          {ok ? "In sync" : meta.indexer.state.replace("_", " ")}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-slate-600 dark:text-slate-400">Indexed block</dt>
        <dd className="text-right font-mono">{meta.indexedBlock ?? "—"}</dd>
        <dt className="text-slate-600 dark:text-slate-400">Chain head</dt>
        <dd className="text-right font-mono">{meta.headBlock ?? "unknown"}</dd>
        <dt className="text-slate-600 dark:text-slate-400">Lag</dt>
        <dd className="text-right font-mono">{meta.indexer.lagBlocks ?? "—"} blocks</dd>
        <dt className="text-slate-600 dark:text-slate-400">Last run</dt>
        <dd className="text-right font-mono">{meta.lastRunAt ? new Date(meta.lastRunAt).toLocaleTimeString() : "never"}</dd>
      </dl>
      {!ok && <p className="text-xs text-slate-600 dark:text-slate-400">{meta.indexer.message}</p>}
    </section>
  );
}

function LastReconciliationCard() {
  const { data, isLoading } = useReports(1);
  const report = data?.reports[0];
  const summary = report?.summaryJson;
  const counts = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<Group, number>;
  if (summary) {
    for (const [status, n] of Object.entries(summary)) {
      const g = GROUP_OF[status as ReconciliationStatus];
      if (g) counts[g] += n;
    }
  }
  const attention = ATTENTION.reduce((n, g) => n + counts[g], 0);
  const beneficiaryMismatches = summary?.beneficiary_mismatch ?? 0;

  return (
    <section aria-label="Last reconciliation" className={`${panel} flex flex-col gap-2.5 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Last reconciliation</h2>
        {report && (
          <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
            #{report.id} · block {report.indexedBlockNumber}
          </span>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !report || !summary ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">No reports yet. Upload a CSV of expected allocations.</p>
          <Link className="inline-flex min-h-11 items-center self-start font-medium text-blue-700 underline dark:text-blue-400" href="/reconcile">
            Reconcile a CSV
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm">
            <strong className="font-semibold">
              {counts.match} of {summary.totalRows}
            </strong>{" "}
            rows matched.{" "}
            {attention > 0 ? (
              <strong className="font-semibold text-orange-800 dark:text-orange-300">
                {attention} need{attention === 1 ? "s" : ""} attention
                {beneficiaryMismatches > 0 &&
                  `, including ${beneficiaryMismatches} beneficiary mismatch${beneficiaryMismatches === 1 ? "" : "es"}`}
                .
              </strong>
            ) : (
              "Nothing needs attention."
            )}
            {report.stale && " Generated from a stale index."}
          </p>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {GROUP_ORDER.filter((g) => counts[g] > 0).map((g) => (
              <span key={g} className={GROUPS[g].bar} style={{ flex: `${counts[g]} 1 0` }} />
            ))}
          </div>
          <Link
            className="inline-flex min-h-11 items-center self-start font-medium text-blue-700 underline dark:text-blue-400"
            href={`/reconcile/${report.id}`}
          >
            Open report
          </Link>
        </>
      )}
    </section>
  );
}
