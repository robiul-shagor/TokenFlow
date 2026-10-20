// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// The deploy script must only ever run on local Anvil and the two supported testnets.
contract DeployScriptTest is Test {
    Deploy internal script;

    function setUp() public {
        script = new Deploy();
    }

    function test_AllowsLocalAndTestnets() public view {
        assertTrue(script.isSupportedChain(31337));
        assertTrue(script.isSupportedChain(11155111));
        assertTrue(script.isSupportedChain(84532));
    }

    function test_RefusesMainnets() public view {
        uint256[6] memory mainnets = [uint256(1), 10, 137, 8453, 42161, 43114];
        for (uint256 i; i < mainnets.length; i++) {
            assertFalse(script.isSupportedChain(mainnets[i]));
        }
    }

    function test_RunRevertsOnMainnet() public {
        vm.chainId(1);
        vm.expectRevert(bytes("Deploy: only Anvil (31337), Sepolia or Base Sepolia"));
        script.run();
    }
}
