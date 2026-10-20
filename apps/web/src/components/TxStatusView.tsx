"use client";

import type { TxState } from "@/lib/txState";
import { Hex, Notice } from "./ui";

/** User-visible transaction lifecycle: preparing → awaiting signature → pending → confirmed / failed / rejected. */
export function TxStatusView({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  const label = state.label ?? "Transaction";
  const hash = state.hash && (
    <span className="ml-1">
      Tx <Hex value={state.hash} />
    </span>
  );
  switch (state.status) {
    case "preparing":
      return <Notice tone="info" title={`${label}: preparing`}>Simulating the call against the local chain…</Notice>;
    case "awaiting_signature":
      return <Notice tone="info" title={`${label}: awaiting confirmation`}>Confirm the transaction in your wallet.</Notice>;
    case "pending":
      return (
        <Notice tone="info" title={`${label}: pending`}>
          Submitted, waiting to be mined.{hash}
        </Notice>
      );
    case "confirmed":
      return (
        <Notice tone="good" title={`${label}: confirmed`}>
          Mined in block {state.blockNumber?.toString()}.{hash}
        </Notice>
      );
    case "rejected":
      return <Notice tone="warn" title={`${label}: rejected`}>{state.error}</Notice>;
    case "failed":
      return (
        <Notice tone="bad" title={`${label}: failed`}>
          {state.error}
          {hash}
        </Notice>
      );
  }
}
