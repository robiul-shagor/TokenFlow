"use client";

import { formatTokenAmount } from "@/lib/amounts";
import { useActivity } from "@/hooks/useIndexedData";
import { EmptyState, Hex, Notice, shorten } from "./ui";

const EVENTS: Record<string, { label: string; dot: string }> = {
  ScheduleCreated: { label: "Created", dot: "bg-blue-600" },
  ScheduleFunded: { label: "Funded", dot: "bg-teal-500" },
  TokensReleased: { label: "Claimed", dot: "bg-emerald-600" },
};

const GRID = "grid grid-cols-[130px_150px_120px_minmax(140px,1fr)_80px_130px] items-center gap-x-4";

/**
 * Indexed event history as a table. `beneficiaries` maps allocation IDs to recipients so events that
 * don't carry one (Funded) still show who the allocation pays.
 */
export function ActivityFeed({
  decimals,
  symbol = "",
  beneficiaries,
  limit = 8,
}: {
  decimals: number;
  symbol?: string;
  beneficiaries?: Map<string, string>;
  limit?: number;
}) {
  const { data, error, isLoading } = useActivity(limit);
  if (isLoading) return <p className="px-4 py-6 text-sm text-slate-500">Loading activity…</p>;
  if (error)
    return (
      <div className="p-4">
        <Notice tone="bad">{(error as Error).message}</Notice>
      </div>
    );
  if (!data || data.events.length === 0) return <EmptyState>No indexed events yet.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px] text-sm">
        <div className={`${GRID} border-b border-[var(--border)] px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400`}>
          <span>Event</span>
          <span>Allocation</span>
          <span>Beneficiary</span>
          <span>Amount</span>
          <span>Block</span>
          <span>Tx</span>
        </div>
        {data.events.map((e) => {
          const amount = e.payload.amount ?? e.payload.totalAmount;
          const ev = EVENTS[e.eventName] ?? { label: e.eventName, dot: "bg-slate-400" };
          const beneficiary = e.payload.beneficiary ?? beneficiaries?.get(e.allocationId);
          return (
            <div key={e.id} className={`${GRID} border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800`}>
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-sm ${ev.dot}`} aria-hidden="true" />
                {ev.label}
              </span>
              <span className="break-all font-mono text-[13px]">{e.allocationId}</span>
              <span className="font-mono text-[13px] text-slate-600 dark:text-slate-400">
                {beneficiary ? shorten(beneficiary, 4) : "—"}
              </span>
              <span className="font-mono text-[13px] tabular-nums">
                {amount ? `${formatTokenAmount(amount, decimals)} ${symbol}` : "—"}
              </span>
              <span className="font-mono text-[13px] text-slate-600 dark:text-slate-400">{e.blockNumber}</span>
              <Hex value={e.transactionHash} chars={4} kind="tx" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
