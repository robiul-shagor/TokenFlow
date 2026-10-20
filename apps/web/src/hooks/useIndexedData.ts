"use client";

import { useQuery } from "@tanstack/react-query";

export interface IndexingMeta {
  chainId: number;
  registry: string;
  token: string;
  tokenDecimals: number | null;
  tokenSymbol: string | null;
  indexedBlock: string | null;
  headBlock: string | null;
  indexer: { state: string; stale: boolean; message: string; lagBlocks: string | null };
  lastRunAt: string | null;
}

export interface IndexedAllocationDto {
  allocationId: string;
  allocationIdHex: `0x${string}`;
  beneficiary: `0x${string}`;
  totalAmount: string;
  releasedAmount: string;
  start: string;
  cliffDuration: string;
  duration: string;
  createdBlock: string;
  createdTxHash: string;
}

export interface ActivityEventDto {
  id: number;
  eventName: string;
  allocationId: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: number;
  payload: Record<string, string>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const POLL_MS = 3_000;

export function useAllocations(beneficiary?: string) {
  const qs = beneficiary ? `?beneficiary=${beneficiary}` : "";
  return useQuery({
    queryKey: ["allocations", beneficiary ?? null],
    queryFn: () => getJson<{ meta: IndexingMeta; allocations: IndexedAllocationDto[] }>(`/api/allocations${qs}`),
    refetchInterval: POLL_MS,
  });
}

export function useActivity(limit = 15, beneficiary?: string) {
  const qs = beneficiary ? `&beneficiary=${beneficiary}` : "";
  return useQuery({
    queryKey: ["activity", limit, beneficiary ?? null],
    queryFn: () =>
      getJson<{ events: ActivityEventDto[]; nextBefore: number | null }>(`/api/activity?limit=${limit}${qs}`),
    refetchInterval: POLL_MS,
  });
}

export interface ReportSummaryDto {
  id: number;
  sourceFilename: string | null;
  indexedBlockNumber: string;
  stale: boolean;
  summaryJson: Record<string, number> & { totalRows: number };
  createdAt: string;
}

export function useReports(limit = 1) {
  return useQuery({
    queryKey: ["reports", limit],
    queryFn: () => getJson<{ reports: ReportSummaryDto[] }>(`/api/reconciliation?limit=${limit}`),
    refetchInterval: 10_000,
  });
}
