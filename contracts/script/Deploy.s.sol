// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VestingRegistry} from "../src/VestingRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice LOCAL DEVELOPMENT ONLY. Deploys the mock token + registry to Anvil (chain 31337) and writes
/// `deployments/31337.json`, which the web app and indexer read. Refuses to run on any other chain.
contract Deploy is Script {
    uint256 constant LOCAL_CHAIN_ID = 31337;

    function run() external {
        require(block.chainid == LOCAL_CHAIN_ID, "Deploy: local Anvil (31337) only");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        MockERC20 token = new MockERC20();
        VestingRegistry registry = new VestingRegistry(token, deployer);
        token.mint(deployer, 10_000_000 ether);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "token", address(token));
        vm.serializeAddress(key, "registry", address(registry));
        vm.serializeAddress(key, "admin", deployer);
        string memory json = vm.serializeUint(key, "deployBlock", block.number);
        vm.writeJson(json, "./deployments/31337.json");

        console.log("MockERC20       ", address(token));
        console.log("VestingRegistry ", address(registry));
        console.log("Manifest written to contracts/deployments/31337.json");
    }
}
