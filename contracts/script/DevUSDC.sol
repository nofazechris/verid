// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice LOCAL DEVELOPMENT ONLY. A 6-decimal USDC stand-in with an open `mint`, deployed by
///         `pnpm dev:chain` to an anvil chain. Never deploy this to a real network: anyone can mint.
///         On Arc the real USDC ERC-20 interface is used instead (see docs/architecture.md).
contract DevUSDC is ERC20 {
    constructor() ERC20("Dev USDC (local only)", "dUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
