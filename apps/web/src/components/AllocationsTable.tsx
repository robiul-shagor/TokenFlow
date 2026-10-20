"use client";

import { useBlock, useReadContracts } from "wagmi";
import { vestingRegistryAbi } from "@/lib/abi";
import { formatTokenAmount } from "@/lib/amounts";
import { SCHEDULE_STATE_LABELS, scheduleState, type ScheduleState } from "@/lib/schedule";
import type { IndexedAllocationDto } from "@/hooks/useIndexedData";
import { useAppConfig } from "./Providers";
import { Badge, EmptyState, Hex, type Tone } from "./ui";

const STATE_TONE: Record<ScheduleState, Tone> = {
  not_started: "neutral",
  cliff: "warn",
  vesting: "info",
  fully_vested: "good",
  completed: "neutral",
};

/** Live `releasable` per allocation, read from the contract (authoritative). */
export function useReleasable(allocations: IndexedAllocationDto[]) {
  const { registry } = useAppConfig();
  return useReadContracts({
    contracts: allocations.map((a) => ({
      address: registry,
      abi: vestingRegistryAbi,
      functionName: "releasable" as const,
      args: [a.allocationIdHex] as const,
    })),
    query: { refetchInterval: 3_000, enabled: allocations.length > 0 },
  });
}

/** `vestedAmount` per allocation at chain time `timestamp` (latest block), read from the contract. */
export function useVested(allocations: IndexedAllocationDto[], timestamp: bigint | undefined) {
  const { registry } = useAppConfig();
  return useReadContracts({
    contracts: allocations.map((a) => ({
      address: registry,
      abi: vestingRegistryAbi,
      functionName: "vestedAmount" as const,
      args: [a.allocationIdHex, timestamp ?? 0n] as const,
    })),
    query: { enabled: allocations.length > 0 && timestamp !== undefined },
  });
}

/** Sum of successful multicall results, or undefined until every read has succeeded. */
export function sumReads(data: readonly { status: string; result?: unknown }[] | undefined, expected: number) {
  if (expected === 0) return 0n;
  if (!data || data.length !== expected || data.some((r) => r.status !== "success")) return undefined;
  return data.reduce((s, r) => s + (r.result as bigint), 0n);
}

export function AllocationsTable({
  allocations,
  decimals,
  symbol,
  renderAction,
}: {
  allocations: IndexedAllocationDto[];
  decimals: number;
  symbol: string;
  renderAction?: (a: IndexedAllocationDto, releasable: bigint | undefined) => React.ReactNode;
}) {
  const releasable = useReleasable(allocations);
  const { data: block } = useBlock({ watch: true });

  if (allocations.length === 0) return <EmptyState>No allocations indexed yet.</EmptyState>;

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2 pr-3">Allocation</th>
            <th className="py-2 pr-3">Beneficiary</th>
            <th className="py-2 pr-3 text-right">Allocated</th>
            <th className="py-2 pr-3 text-right">Claimed</th>
            <th className="py-2 pr-3 text-right">Claimable (live)</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Created in tx</th>
            {renderAction && <th className="py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {allocations.map((a, i) => {
            const r = releasable.data?.[i];
            const claimable = r?.status === "success" ? (r.result as bigint) : undefined;
            const state = block
              ? scheduleState(
                  {
                    start: BigInt(a.start),
                    cliffDuration: BigInt(a.cliffDuration),
                    duration: BigInt(a.duration),
                    totalAmount: BigInt(a.totalAmount),
                    released: BigInt(a.releasedAmount),
                  },
                  block.timestamp,
                )
              : null;
            return (
              <tr key={a.allocationIdHex}>
                <td className="py-2 pr-3 font-medium">{a.allocationId}</td>
                <td className="py-2 pr-3">
                  <Hex value={a.beneficiary} chars={4} />
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatTokenAmount(a.totalAmount, decimals)} {symbol}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatTokenAmount(a.releasedAmount, decimals)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {claimable === undefined ? (releasable.isError ? "RPC error" : "…") : formatTokenAmount(claimable, decimals)}
                </td>
                <td className="py-2 pr-3">{state && <Badge tone={STATE_TONE[state]}>{SCHEDULE_STATE_LABELS[state]}</Badge>}</td>
                <td className="py-2 pr-3">
                  <Hex value={a.createdTxHash} chars={4} />
                </td>
                {renderAction && <td className="py-2 text-right">{renderAction(a, claimable)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
