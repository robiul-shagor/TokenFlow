// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VestingRegistry} from "../src/VestingRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice LOCAL DEVELOPMENT ONLY. Creates demo schedules for Anvil's default accounts #1 and #2.
/// Run after Deploy; reads addresses from `deployments/31337.json`.
contract Seed is Script {
    // Anvil default account #1 and #2 (public, well-known, disposable development addresses).
    address constant BENEFICIARY_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant BENEFICIARY_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function run() external {
        require(block.chainid == 31337, "Seed: local Anvil (31337) only");
        string memory json = vm.readFile("./deployments/31337.json");
        VestingRegistry registry = VestingRegistry(vm.parseJsonAddress(json, ".registry"));
        MockERC20 token = MockERC20(vm.parseJsonAddress(json, ".token"));

        // Fixed timestamps so sample-data/*.csv can match exactly. Vesting state depends on Anvil's clock,
        // which starts at wall-clock time unless `anvil --timestamp` is used.
        vm.startBroadcast();
        token.approve(address(registry), type(uint256).max);
        // 2026-01-01 UTC, no cliff, 2-year linear vesting.
        registry.createSchedule(bytes32("team-001"), BENEFICIARY_1, 1_000 ether, 1767225600, 0, 730 days);
        // 2026-09-01 UTC, 180-day cliff, 1-year vesting.
        registry.createSchedule(bytes32("advisor-001"), BENEFICIARY_2, 250 ether, 1788220800, 180 days, 365 days);
        // 2025-01-01 UTC, 1-year vesting: fully vested.
        registry.createSchedule(bytes32("seed-001"), BENEFICIARY_1, 500 ether, 1735689600, 0, 365 days);
        // Deliberately absent from the sample CSVs, to demonstrate "on-chain, not in CSV".
        registry.createSchedule(bytes32("partner-001"), BENEFICIARY_2, 75 ether, 1767225600, 30 days, 365 days);
        vm.stopBroadcast();
        console.log("Seeded 4 schedules");
    }
}
