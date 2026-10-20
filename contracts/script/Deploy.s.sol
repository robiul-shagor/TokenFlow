// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VestingRegistry} from "../src/VestingRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Deploys the registry (and, unless `TOKEN_ADDRESS` is set, the freely mintable test token) and
/// writes `deployments/<chainId>.json`, which the web app and indexer read.
///
/// Runs only on local Anvil (31337), Sepolia (11155111) and Base Sepolia (84532). Every other chain,
/// including every mainnet, is refused: the contracts are unaudited and meant for test tokens only.
///
/// Optional env:
/// - `TOKEN_ADDRESS`: reuse an existing ERC-20 instead of deploying MockERC20.
/// - `ADMIN_ADDRESS`: registry admin + schedule manager (for example a Safe). Defaults to the deployer.
contract Deploy is Script {
    uint256 constant LOCAL_CHAIN_ID = 31337;
    uint256 constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external {
        require(isSupportedChain(block.chainid), "Deploy: only Anvil (31337), Sepolia or Base Sepolia");

        address existingToken = vm.envOr("TOKEN_ADDRESS", address(0));

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address admin = vm.envOr("ADMIN_ADDRESS", deployer);

        IERC20 token;
        if (existingToken == address(0)) {
            MockERC20 mock = new MockERC20();
            mock.mint(deployer, 10_000_000 ether);
            token = mock;
        } else {
            token = IERC20(existingToken);
        }
        VestingRegistry registry = new VestingRegistry(token, admin);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "token", address(token));
        vm.serializeAddress(key, "registry", address(registry));
        vm.serializeAddress(key, "admin", admin);
        string memory json = vm.serializeUint(key, "deployBlock", block.number);
        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console.log("Token           ", address(token));
        console.log("VestingRegistry ", address(registry));
        console.log("Admin           ", admin);
        console.log("Manifest written to contracts/deployments/<chainId>.json");
    }

    function isSupportedChain(uint256 chainId) public pure returns (bool) {
        return chainId == LOCAL_CHAIN_ID || chainId == SEPOLIA_CHAIN_ID || chainId == BASE_SEPOLIA_CHAIN_ID;
    }
}
