"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Hex } from "viem";
import { useConnection } from "wagmi";
import { useTxFlow } from "@/hooks/useTxFlow";
import { vestingRegistryAbi } from "@/lib/abi";
import { isTxBusy } from "@/lib/txState";
import { TxStatusView } from "./TxStatusView";

/**
 * Claim is enabled only when the connected account is the beneficiary and the contract reports a
 * non-zero `releasable` amount. The contract re-checks both on submission.
 */
export function ClaimButton({
  registry,
  allocationIdHex,
  beneficiary,
  releasable,
  label = "Claim",
  size = "md",
  align = "end",
}: {
  registry: `0x${string}`;
  allocationIdHex: Hex;
  beneficiary: string;
  releasable: bigint | undefined;
  label?: string;
  size?: "md" | "lg";
  align?: "start" | "end";
}) {
  const { address } = useConnection();
  const queryClient = useQueryClient();
  const { state, run } = useTxFlow();
  const isBeneficiary = !!address && address.toLowerCase() === beneficiary.toLowerCase();
  const disabledReason = !isBeneficiary
    ? "Only the beneficiary can claim"
    : releasable === undefined
      ? "Loading claimable amount"
      : releasable === 0n
        ? "Nothing claimable yet"
        : null;

  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      <button
        className={size === "lg" ? "btn-primary min-h-12 px-5 text-base font-semibold" : "btn-primary min-h-11"}
        disabled={!!disabledReason || isTxBusy(state)}
        title={disabledReason ?? undefined}
        onClick={async () => {
          const receipt = await run("Claim", {
            address: registry,
            abi: vestingRegistryAbi,
            functionName: "release",
            args: [allocationIdHex],
          });
          if (receipt) await queryClient.invalidateQueries();
        }}
      >
        {state.status === "awaiting_signature" ? "Confirm in your wallet…" : isTxBusy(state) ? "Claiming…" : label}
      </button>
      {disabledReason && <span className="text-xs text-slate-500">{disabledReason}</span>}
      <div className="w-full max-w-sm text-left">
        <TxStatusView state={state} />
      </div>
    </div>
  );
}
