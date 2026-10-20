import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toEventSignature, toFunctionSignature, type AbiEvent, type AbiFunction } from "viem";
import { vestingRegistryAbi } from "./abi";

const artifact = join(__dirname, "../../../../contracts/out/VestingRegistry.sol/VestingRegistry.json");

describe.skipIf(!existsSync(artifact))("ABI matches Foundry artifact", () => {
  it("every hand-written function and event exists in the compiled contract", () => {
    const compiled = JSON.parse(readFileSync(artifact, "utf8")).abi as (AbiFunction | AbiEvent)[];
    const sig = (x: AbiFunction | AbiEvent) =>
      x.type === "event" ? toEventSignature(x) : toFunctionSignature(x as AbiFunction);
    const compiledSigs = new Set(compiled.filter((x) => x.type === "function" || x.type === "event").map(sig));
    for (const item of vestingRegistryAbi) {
      if (item.type === "function" || item.type === "event") {
        expect(compiledSigs, `${item.name}`).toContain(sig(item as AbiFunction | AbiEvent));
      }
    }
  });
});
