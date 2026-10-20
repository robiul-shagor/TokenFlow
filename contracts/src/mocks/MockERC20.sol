// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Freely mintable test token with no monetary value. Local Anvil and testnets only: anyone can
/// mint, which doubles as the faucet for testnet demos.
contract MockERC20 is ERC20 {
    constructor() ERC20("TokenFlow Test Token", "TFT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
