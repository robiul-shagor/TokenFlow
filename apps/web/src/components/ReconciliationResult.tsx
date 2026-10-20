"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTokenAmount } from "@/lib/amounts";
import { networkForChainId } from "@/lib/chain";
import { STATUS_LABELS, type ReconciliationStatus } from "@/lib/reconcile";
import type { SerializedReport } from "@/server/reports";
import { Hex, shorten } from "./ui";

type Row = SerializedReport["rows"][number];

/** Statuses are grouped for filtering; each group pairs a glyph with its color so it never relies on hue alone. */
export const GROUPS = {
  mismatch: {
    label: "Mismatch",
    glyph: "≠",
    pill: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300",
    glyphText: "text-orange-800 dark:text-orange-300",
    bar: "bg-orange-500",
  },
  missing: {
    label: "Missing on-chain",
    glyph: "−",
    pill: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300",
    glyphText: "text-blue-800 dark:text-blue-300",
    bar: "bg-blue-600",
  },
  extra: {
    label: "Not in CSV",
    glyph: "+",
    pill: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300",
    glyphText: "text-teal-800 dark:text-teal-300",
    bar: "bg-teal-500",
  },
  input: {
    label: "Input error",
    glyph: "!",
    pill: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300",
    glyphText: "text-purple-800 dark:text-purple-300",
    bar: "bg-purple-500",
  },
  pending: {
    label: "Can't verify yet",
    glyph: "…",
    pill: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    glyphText: "text-stone-600 dark:text-stone-400",
    bar: "bg-stone-400",
  },
  match: {
    label: "Matched",
    glyph: "=",
    pill: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    glyphText: "text-emerald-800 dark:text-emerald-300",
    bar: "bg-emerald-600",
  },
} as const;
export type Group = keyof typeof GROUPS;
export const GROUP_ORDER: Group[] = ["mismatch", "missing", "extra", "input", "pending", "match"];
export const ATTENTION: Group[] = ["mismatch", "missing", "extra", "input"];

export const GROUP_OF: Record<ReconciliationStatus, Group> = {
  matched: "match",
  amount_mismatch: "mismatch",
  beneficiary_mismatch: "mismatch",
  schedule_mismatch: "mismatch",
  missing_onchain: "missing",
  pending_indexing: "pending",
  unexpected_onchain: "extra",
  duplicate_csv: "input",
  invalid_row: "input",
};

const NEXT_STEP: Record<ReconciliationStatus, string> = {
  matched: "Nothing to do.",
  amount_mismatch:
    "Find out which source is wrong before anyone claims. The contract can't edit a schedule, so correcting the chain is an admin decision outside this tool.",
  beneficiary_mismatch:
    "Treat as urgent: tokens would vest to the wrong wallet. Confirm the address with the recipient through a trusted channel.",
  schedule_mismatch:
    "Check the signed terms. A different start, cliff or duration changes when tokens can be claimed.",
  missing_onchain: "Create and fund this allocation, or remove it from the CSV if it was cancelled.",
  pending_indexing: "Re-run once the indexer reaches the chain head. Nothing is wrong yet.",
  unexpected_onchain: "Check who created it. If the allocation is legitimate, add it to the CSV.",
  duplicate_csv: "Keep one row in the CSV and re-run. The tool never guesses which duplicate is correct.",
  invalid_row: "Fix the row in the CSV and re-run. Values are never rounded or guessed.",
};

type Filter = Group | "all" | "attention";

function StatusPill({ status }: { status: ReconciliationStatus }) {
  const g = GROUPS[GROUP_OF[status]];
  return (
    <span className={`inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${g.pill}`}>
      <span className="font-mono" aria-hidden="true">
        {g.glyph}
      </span>
      {STATUS_LABELS[status]}
    </span>
  );
}

const btn =
  "inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 font-medium hover:bg-slate-100 dark:hover:bg-slate-800";
const label = "text-xs text-slate-500 dark:text-slate-400";
const ROW_GRID = "grid grid-cols-[170px_110px_110px_110px_minmax(180px,1fr)] gap-x-3";

export function ReconciliationResult({ report }: { report: SerializedReport }) {
  const m = report.meta;
  const counts = useMemo(() => {
    const c = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<Group, number>;
    for (const r of report.rows) c[GROUP_OF[r.status]]++;
    return c;
  }, [report.rows]);
  const attentionCount = ATTENTION.reduce((n, g) => n + counts[g], 0);

  const [filter, setFilter] = useState<Filter>(attentionCount > 0 ? "attention" : "all");
  const [units, setUnits] = useState<"token" | "raw">("token");
  const [selected, setSelected] = useState<number | null>(null);

  // Keep the report's own index as identity; sort by group, then CSV line.
  const sorted = useMemo(
    () =>
      report.rows
        .map((row, index) => ({ row, index, group: GROUP_OF[row.status] }))
        .sort(
          (a, b) =>
            GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
            (a.row.sourceRowNumber ?? Infinity) - (b.row.sourceRowNumber ?? Infinity),
        ),
    [report.rows],
  );
  const visible = sorted.filter(({ group }) =>
    filter === "all" ? true : filter === "attention" ? ATTENTION.includes(group) : group === filter,
  );
  const current = sorted.find((r) => r.index === selected) ?? visible[0] ?? sorted[0];

  // Full precision in token units: truncating could make two different amounts look equal.
  const amount = (raw: string | null) =>
    raw === null ? "—" : units === "raw" ? raw : formatTokenAmount(raw, m.tokenDecimals, m.tokenDecimals);

  const behindBy = m.chainHeadBlock === null ? null : BigInt(m.chainHeadBlock) - BigInt(m.indexedBlock);
  const generated = new Date(m.generatedAt).toLocaleString();

  const chips: { key: Filter; label: string; glyph: string; n: number; glyphText?: string }[] = [
    { key: "attention", label: "Needs attention", glyph: "•", n: attentionCount },
    { key: "all", label: "All", glyph: "∗", n: report.summary.totalRows },
    ...GROUP_ORDER.filter((g) => counts[g] > 0).map((g) => ({
      key: g,
      label: GROUPS[g].label,
      glyph: GROUPS[g].glyph,
      n: counts[g],
      glyphText: GROUPS[g].glyphText,
    })),
  ];
  const tableTitle = filter === "all" ? "All rows" : filter === "attention" ? "Needs attention" : GROUPS[filter].label;
  const barLabel = GROUP_ORDER.filter((g) => counts[g] > 0)
    .map((g) => `${counts[g]} ${GROUPS[g].label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reconciliation report #{report.id}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Source <span className="font-mono text-foreground">{m.sourceFilename ?? "uploaded CSV"}</span> ·{" "}
            {report.summary.totalRows} rows · generated {generated}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link className={btn} href="/reconcile">
            Upload new CSV
          </Link>
          <a
            className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            href={`/api/reconciliation/${report.id}/export`}
            download
          >
            Export CSV
          </a>
        </div>
      </div>

      {m.stale && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-950 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200"
        >
          <p className="min-w-0 flex-[1_1_420px]">
            <strong>
              {behindBy === null
                ? "The chain head was unknown when this report was generated."
                : `The index was ${behindBy} blocks behind the chain head (${m.chainHeadBlock}).`}
            </strong>{" "}
            Results are as of block {m.indexedBlock}. Rows that may exist in newer blocks are marked &quot;Can&apos;t
            verify yet&quot;, not counted as missing.
          </p>
          <Link className={`${btn} border-orange-300 dark:border-orange-900`} href="/reconcile">
            Re-run when caught up
          </Link>
        </div>
      )}

      <section
        aria-label="Report provenance"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] text-sm"
      >
        <div className="bg-[var(--surface)] px-4 py-3">
          <p className={label}>Chain</p>
          <p className="mt-1 font-mono">
            {m.chainId} · {networkForChainId(m.chainId)?.label ?? "unknown network"}
          </p>
        </div>
        <div className="bg-[var(--surface)] px-4 py-3">
          <p className={label}>Vesting registry</p>
          <p className="mt-1">
            <Hex value={m.contractAddress} chars={4} kind="address" />
          </p>
        </div>
        <div className="bg-[var(--surface)] px-4 py-3">
          <p className={label}>Token</p>
          <p className="mt-1 flex flex-wrap items-center gap-1">
            <Hex value={m.tokenAddress} chars={4} kind="address" />
            <span className="font-mono text-xs">· {m.tokenDecimals} dec</span>
          </p>
        </div>
        <div className="bg-[var(--surface)] px-4 py-3">
          <p className={label}>Compared against</p>
          <p className="mt-1 font-mono font-medium">Block {m.indexedBlock}</p>
        </div>
        <div className="bg-[var(--surface)] px-4 py-3">
          <p className={label}>Index status</p>
          <p
            className={`mt-1 flex items-center gap-2 font-medium ${m.stale ? "text-orange-800 dark:text-orange-300" : "text-emerald-800 dark:text-emerald-300"}`}
          >
            <span className={`h-2 w-2 rounded-full ${m.stale ? "bg-orange-500" : "bg-emerald-600"}`} aria-hidden="true" />
            {m.stale
              ? behindBy === null
                ? "Chain head unknown"
                : `${behindBy} blocks behind (head ${m.chainHeadBlock})`
              : "Up to date with head"}
          </p>
        </div>
      </section>

      <section aria-label="Summary" className="card flex flex-col gap-4 p-5">
        <div>
          <p className="text-xl tracking-tight">
            <strong className="font-semibold">
              {counts.match} of {report.summary.totalRows}
            </strong>{" "}
            rows match on-chain records
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {attentionCount === 0
              ? "Nothing needs attention."
              : `${attentionCount} ${attentionCount === 1 ? "row needs" : "rows need"} attention.`}
            {counts.extra > 0 &&
              ` Includes ${counts.extra} on-chain ${counts.extra === 1 ? "allocation" : "allocations"} the CSV doesn't list.`}
            {counts.pending > 0 &&
              ` ${counts.pending} ${counts.pending === 1 ? "row" : "rows"} can't be verified until the index reaches the chain head.`}
          </p>
        </div>
        <div role="img" aria-label={barLabel} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {GROUP_ORDER.filter((g) => counts[g] > 0).map((g) => (
            <span key={g} className={GROUPS[g].bar} style={{ flex: `${counts[g]} 1 0` }} />
          ))}
        </div>
        <div role="group" aria-label="Filter rows by status" className="flex flex-wrap gap-2 text-sm">
          {chips.map((c) => {
            const on = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setFilter(c.key);
                  setSelected(null);
                }}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 font-medium ${
                  on
                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-[var(--border)] bg-[var(--surface)] hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <span className={`font-mono ${on ? "" : (c.glyphText ?? "text-slate-500")}`} aria-hidden="true">
                  {c.glyph}
                </span>
                {c.label}
                <span className="font-mono text-xs opacity-80">{c.n}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label="Reconciliation rows"
          className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">
              {tableTitle} · {visible.length}
            </h2>
            <div role="group" aria-label="Amount units" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-slate-800">
              {(["token", "raw"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={units === u}
                  onClick={() => setUnits(u)}
                  className={`min-h-9 rounded-md px-3 ${units === u ? "bg-[var(--surface)] font-semibold shadow-sm" : ""}`}
                >
                  {u === "token" ? "Token units" : "Raw integers"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className={`${ROW_GRID} border-b border-[var(--border)] px-4 py-2.5 ${label}`}>
                <span>Status</span>
                <span>Allocation ID</span>
                <span>Expected (CSV)</span>
                <span>On-chain</span>
                <span>Why</span>
              </div>
              {visible.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No rows in this filter.</p>}
              {visible.map(({ row, index, group }) => {
                const isSel = current?.index === index;
                return (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={isSel}
                    onClick={() => setSelected(index)}
                    className={`${ROW_GRID} w-full items-start border-b border-slate-100 px-4 py-3.5 text-left text-sm last:border-b-0 dark:border-slate-800 ${
                      isSel ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-900"
                    }`}
                  >
                    <StatusPill status={row.status} />
                    <span className={`break-all font-mono text-[13px] ${isSel ? "font-semibold" : ""}`}>{row.allocationId ?? "—"}</span>
                    <span className="break-all font-mono text-[13px] tabular-nums">{amount(row.expectedAmountRaw)}</span>
                    <span
                      className={`break-all font-mono text-[13px] tabular-nums ${
                        group === "mismatch" && row.status === "amount_mismatch"
                          ? "font-semibold text-orange-800 dark:text-orange-300"
                          : row.actualAmountRaw === null
                            ? "text-slate-500"
                            : ""
                      }`}
                    >
                      {row.actualAmountRaw === null && row.status === "pending_indexing" ? "not indexed" : amount(row.actualAmountRaw)}
                    </span>
                    <span className="text-[13px] text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400">{row.message}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {current && <RowDetail row={current.row} amount={amount} reportId={report.id} />}
      </div>

      <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
        This report compares the uploaded CSV with events indexed up to the block shown above. The vesting contract
        stays the source of truth; this is a snapshot, not a live view. Amounts are compared as raw integers; token
        units are for display only.
      </p>
    </div>
  );
}

function RowDetail({ row, amount, reportId }: { row: Row; amount: (raw: string | null) => string; reportId: number }) {
  const onchainOnly = row.status === "unexpected_onchain";
  const notLookedUp = row.status === "invalid_row" || row.status === "duplicate_csv";
  const mark = (ok: boolean | null) =>
    ok === null
      ? { glyph: "–", cls: "text-slate-400" }
      : ok
        ? { glyph: "=", cls: "text-emerald-700 dark:text-emerald-400" }
        : { glyph: "≠", cls: "text-orange-700 dark:text-orange-400" };

  const amountsKnown = row.expectedAmountRaw !== null && row.actualAmountRaw !== null;
  const compared = ["matched", "amount_mismatch", "beneficiary_mismatch", "schedule_mismatch"].includes(row.status);
  const sameText = (ok: boolean | null) => (ok === true ? "same" : ok === false ? "differs (see above)" : "—");
  const benOk = row.status === "beneficiary_mismatch" ? false : compared ? true : null;
  const schedOk = row.status === "schedule_mismatch" ? false : compared ? true : null;
  const fields = [
    {
      name: "Beneficiary",
      csv: onchainOnly || !row.beneficiaryAddress ? "—" : shorten(row.beneficiaryAddress, 4),
      chain: onchainOnly && row.beneficiaryAddress ? shorten(row.beneficiaryAddress, 4) : sameText(benOk),
      ok: benOk,
    },
    {
      name: "Amount",
      csv: amount(row.expectedAmountRaw),
      chain: row.status === "pending_indexing" ? "not indexed" : amount(row.actualAmountRaw),
      ok: amountsKnown && !notLookedUp ? row.expectedAmountRaw === row.actualAmountRaw : null,
    },
    { name: "Schedule", csv: onchainOnly ? "—" : "listed", chain: sameText(schedOk), ok: schedOk },
  ];

  return (
    <aside
      aria-label="Selected row detail"
      className="flex min-w-0 flex-[1_1_330px] flex-col gap-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill status={row.status} />
          <span className={label}>{row.sourceRowNumber === null ? "On-chain only" : `CSV line ${row.sourceRowNumber}`}</span>
        </div>
        <h2 className="break-all font-mono text-xl font-medium">{row.allocationId ?? "(no allocation ID)"}</h2>
        <p className="text-[15px] [overflow-wrap:anywhere]">{row.message}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Field by field</h3>
        <div className={`grid grid-cols-[76px_minmax(0,1fr)_minmax(0,1fr)_18px] gap-2.5 px-2.5 ${label}`}>
          <span>Field</span>
          <span>CSV</span>
          <span>On-chain</span>
          <span />
        </div>
        {fields.map((f) => {
          const mk = mark(f.ok);
          return (
            <div
              key={f.name}
              className={`grid grid-cols-[76px_minmax(0,1fr)_minmax(0,1fr)_18px] items-start gap-2.5 rounded-md px-2.5 py-2 ${
                f.ok === false ? "bg-orange-50 dark:bg-orange-950/40" : ""
              }`}
            >
              <span className="text-[13px] text-slate-600 dark:text-slate-400">{f.name}</span>
              <span className="font-mono text-xs [overflow-wrap:anywhere]">{f.csv}</span>
              <span className="font-mono text-xs [overflow-wrap:anywhere]">{f.chain}</span>
              <span className={`text-center font-mono text-sm font-medium ${mk.cls}`}>
                <span aria-hidden="true">{mk.glyph}</span>
                <span className="sr-only">{f.ok === null ? "not compared" : f.ok ? "matches" : "differs"}</span>
              </span>
            </div>
          );
        })}
        {row.beneficiaryAddress && (
          <p className="px-2.5 pt-1 text-xs text-slate-500">
            Full address: <Hex value={row.beneficiaryAddress} chars={10} kind="address" />
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-4 dark:border-slate-800">
        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">Suggested next step</h3>
        <p className="text-sm">{NEXT_STEP[row.status]}</p>
        {row.status === "missing_onchain" && row.allocationId && (
          <Link
            className="inline-flex min-h-11 items-center self-start font-medium text-blue-700 underline dark:text-blue-400"
            href={`/allocations/new?${new URLSearchParams({
              fromReport: String(reportId),
              id: row.allocationId,
              beneficiary: row.beneficiaryAddress ?? "",
              amountRaw: row.expectedAmountRaw ?? "",
            })}`}
          >
            Create this allocation
          </Link>
        )}
      </div>
    </aside>
  );
}
