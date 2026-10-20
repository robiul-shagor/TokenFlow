"use client";

import { useCallback, useEffect, useReducer } from "react";
import { useConfig, useConnection } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract, type SimulateContractParameters } from "wagmi/actions";
import { classifyTxError, idleTx, txReducer } from "@/lib/txState";

/**
 * Runs a contract write through simulate → sign → wait, exposing each state. The simulation uses the
 * contract itself, so reverts surface before the wallet prompt. Resets when the account changes.
 */
export function useTxFlow() {
  const config = useConfig();
  const { address } = useConnection();
  const [state, dispatch] = useReducer(txReducer, idleTx);

  useEffect(() => {
    dispatch({ type: "reset" });
  }, [address]);

  const run = useCallback(
    async (label: string, params: SimulateContractParameters) => {
      dispatch({ type: "prepare", label });
      try {
        const { request } = await simulateContract(config, params);
        dispatch({ type: "awaitSignature" });
        const hash = await writeContract(config, request);
        dispatch({ type: "submitted", hash });
        const receipt = await waitForTransactionReceipt(config, { hash });
        if (receipt.status !== "success") {
          dispatch({ type: "failed", message: "Transaction reverted on-chain" });
          return null;
        }
        dispatch({ type: "confirmed", blockNumber: receipt.blockNumber });
        return receipt;
      } catch (err) {
        const c = classifyTxError(err);
        dispatch(c.kind === "rejected" ? { type: "rejected" } : { type: "failed", message: c.message });
        return null;
      }
    },
    [config],
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  return { state, run, reset };
}
