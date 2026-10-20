import { describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  TransactionExecutionError,
  UserRejectedRequestError,
  encodeErrorResult,
} from "viem";
import { vestingRegistryAbi } from "./abi";
import { classifyTxError, idleTx, isTxBusy, txReducer } from "./txState";

describe("txReducer", () => {
  it("walks the happy path", () => {
    let s = txReducer(idleTx, { type: "prepare", label: "Claim" });
    expect(s.status).toBe("preparing");
    expect(isTxBusy(s)).toBe(true);
    s = txReducer(s, { type: "awaitSignature" });
    expect(s.status).toBe("awaiting_signature");
    s = txReducer(s, { type: "submitted", hash: "0xabc" });
    expect(s).toMatchObject({ status: "pending", hash: "0xabc" });
    s = txReducer(s, { type: "confirmed", blockNumber: 7n });
    expect(s).toMatchObject({ status: "confirmed", blockNumber: 7n, label: "Claim" });
    expect(isTxBusy(s)).toBe(false);
  });

  it("records rejection and failure, and resets", () => {
    expect(txReducer(idleTx, { type: "rejected" }).status).toBe("rejected");
    expect(txReducer(idleTx, { type: "failed", message: "x" })).toMatchObject({ status: "failed", error: "x" });
    expect(txReducer({ ...idleTx, status: "failed" }, { type: "reset" })).toEqual(idleTx);
  });
});

describe("classifyTxError", () => {
  it("detects a wallet rejection nested in a viem error", () => {
    const err = new BaseError("outer", { cause: new UserRejectedRequestError(new Error("User denied")) });
    expect(classifyTxError(err).kind).toBe("rejected");
    expect(classifyTxError({ code: 4001 }).kind).toBe("rejected");
  });

  it("maps custom contract errors to friendly messages", () => {
    const revert = new ContractFunctionRevertedError({
      abi: vestingRegistryAbi,
      functionName: "release",
      data: encodeErrorResult({ abi: vestingRegistryAbi, errorName: "NothingToRelease" }),
    });
    expect(classifyTxError(new BaseError("outer", { cause: revert }))).toEqual({
      kind: "failed",
      message: "Nothing is claimable yet.",
    });
  });

  it("falls back to the short message", () => {
    const err = new TransactionExecutionError(new BaseError("insufficient funds"), {} as never);
    expect(classifyTxError(err)).toMatchObject({ kind: "failed" });
    expect(classifyTxError(new Error("boom"))).toEqual({ kind: "failed", message: "boom" });
  });
});
