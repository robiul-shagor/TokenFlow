import { anvil } from "viem/chains";

/** The only chain this MVP supports. Every other chain ID is rejected (fail closed). */
export const LOCAL_CHAIN = anvil;
export const LOCAL_CHAIN_ID = 31337 as const;

export function isSupportedChain(chainId: number | undefined): chainId is typeof LOCAL_CHAIN_ID {
  return chainId === LOCAL_CHAIN_ID;
}
