"use client";

import type { IndexingMeta } from "@/hooks/useIndexedData";
import { Badge, Notice, type Tone } from "./ui";

const STATE_TONE: Record<string, Tone> = {
  synced: "good",
  behind: "warn",
  stalled: "bad",
  not_started: "warn",
  error: "bad",
  rpc_unavailable: "bad",
};

export function IndexingBadge({ meta }: { meta: IndexingMeta }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-500">
      <Badge tone={STATE_TONE[meta.indexer.state] ?? "neutral"}>indexer: {meta.indexer.state.replace("_", " ")}</Badge>
      indexed block {meta.indexedBlock ?? "—"} / head {meta.headBlock ?? "unknown"}
    </span>
  );
}

/** Prominent warning whenever the read model may not reflect the chain head. */
export function StaleIndexWarning({ meta }: { meta: IndexingMeta }) {
  if (!meta.indexer.stale) return null;
  return (
    <Notice tone={meta.indexer.state === "behind" ? "warn" : "bad"} title="Indexed data may be out of date">
      {meta.indexer.message}. Tables below reflect block {meta.indexedBlock ?? "—"}; claimable amounts are read live from
      the contract.
    </Notice>
  );
}
