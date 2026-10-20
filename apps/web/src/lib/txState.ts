import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import type { Hex } from "viem";

export type TxStatus = "idle" | "preparing" | "awaiting_signature" | "pending" | "confirmed" | "failed" | "rejected";

export interface TxState {
  status: TxStatus;
  label: string | null;
  hash: Hex | null;
  blockNumber: bigint | null;
  error: string | null;
}

export type TxAction =
  | { type: "prepare"; label: string }
  | { type: "awaitSignature" }
  | { type: "submitted"; hash: Hex }
  | { type: "confirmed"; blockNumber: bigint }
  | { type: "failed"; message: string }
  | { type: "rejected" }
  | { type: "reset" };

export const idleTx: TxState = { status: "idle", label: null, hash: null, blockNumber: null, error: null };

export function txReducer(state: TxState, action: TxAction): TxState {
  switch (action.type) {
    case "prepare":
      return { ...idleTx, status: "preparing", label: action.label };
    case "awaitSignature":
      return { ...state, status: "awaiting_signature" };
    case "submitted":
      return { ...state, status: "pending", hash: action.hash };
    case "confirmed":
      return { ...state, status: "confirmed", blockNumber: action.blockNumber };
    case "failed":
      return { ...state, status: "failed", error: action.message };
    case "rejected":
      return { ...state, status: "rejected", error: "The request was rejected in the wallet. Nothing was sent." };
    case "reset":
      return idleTx;
  }
}

export const isTxBusy = (s: TxState) => s.status === "preparing" || s.status === "awaiting_signature" || s.status === "pending";

const FRIENDLY_REVERTS: Record<string, string> = {
  AccessControlUnauthorizedAccount: "The connected account is not allowed to create schedules (missing SCHEDULE_MANAGER_ROLE).",
  AllocationExists: "An allocation with this ID already exists on-chain.",
  InvalidAllocationId: "The allocation ID is invalid.",
  ZeroAddress: "The beneficiary cannot be the zero address.",
  InvalidAmount: "The amount must be greater than zero.",
  InvalidDuration: "The vesting duration must be greater than zero.",
  CliffExceedsDuration: "The cliff cannot be longer than the vesting duration.",
  NotBeneficiary: "Only the beneficiary can claim this allocation.",
  NothingToRelease: "Nothing is claimable yet.",
  UnknownAllocation: "This allocation does not exist on-chain.",
  UnsupportedToken: "The token transferred an unexpected amount (fee-on-transfer tokens are not supported).",
  ERC20InsufficientBalance: "The connected account does not hold enough test tokens.",
  ERC20InsufficientAllowance: "The registry is not approved to transfer enough test tokens.",
};

export function classifyTxError(err: unknown): { kind: "rejected" | "failed"; message: string } {
  if ((err as { code?: number })?.code === 4001) return { kind: "rejected", message: "Rejected in wallet" };
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return { kind: "rejected", message: "Rejected in wallet" };
    }
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      return { kind: "failed", message: (name && FRIENDLY_REVERTS[name]) || revert.shortMessage };
    }
    return { kind: "failed", message: err.shortMessage };
  }
  return { kind: "failed", message: (err as Error)?.message ?? "Unknown error" };
}
