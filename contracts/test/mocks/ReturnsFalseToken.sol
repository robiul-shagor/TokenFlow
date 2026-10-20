// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal non-reverting token whose transfers return false; SafeERC20 must turn that into a revert.
contract ReturnsFalseToken {
    mapping(address => uint256) public balanceOf;

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
