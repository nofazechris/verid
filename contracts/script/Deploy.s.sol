// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VeridRegistry} from "../src/VeridRegistry.sol";
import {VeridValidation} from "../src/VeridValidation.sol";
import {VeridEscrow, IVeridValidation, IVeridRegistry} from "../src/VeridEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys VeridRegistry and VeridValidation, and (optionally) VeridEscrow.
///
/// SECURITY: this script never reads or stores a private key. The signer is
/// chosen on the command line, preferably an encrypted Foundry keystore:
///
///   cast wallet import verid-deployer --interactive      # one-time, prompts for the key
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL \
///       --account verid-deployer --broadcast
///
/// Required env: VERID_OWNER (address that will own both contracts; use a
/// multisig/hardware wallet, NOT the hot deployer key), VERID_ANCHORER (address
/// of the backend relayer allowed to anchor).
/// Optional env: VERID_VALIDATOR (address registered as the on-chain validator, id
/// keccak256("verid-validator"); without one nothing can ever be recorded as Pass),
/// VERID_USDC (ERC-20 the escrow holds; set it to deploy VeridEscrow, which has no
/// owner and no admin functions). Do NOT run against Mainnet until
/// all tests pass and the official Arc network parameters have been re-verified.
contract Deploy is Script {
    function run() external returns (VeridRegistry registry, VeridValidation validation, VeridEscrow escrow) {
        address owner = vm.envAddress("VERID_OWNER");
        address anchorer = vm.envAddress("VERID_ANCHORER");
        require(owner != address(0) && anchorer != address(0), "zero address");
        address validator = vm.envOr("VERID_VALIDATOR", address(0));
        address usdc = vm.envOr("VERID_USDC", address(0));

        console2.log("chainid       :", block.chainid);
        console2.log("owner         :", owner);
        console2.log("anchorer      :", anchorer);

        vm.startBroadcast();
        // IMPORTANT: inside a broadcast, transactions are sent by the BROADCASTER,
        // which is not necessarily `msg.sender` of run(). Always ask Foundry who it is.
        (, address deployer,) = vm.readCallers();

        // The deployer owns the contracts only long enough to configure them,
        // then starts the two-step handoff to the real owner.
        registry = new VeridRegistry(deployer);
        validation = new VeridValidation(deployer);
        registry.setAnchorer(anchorer, true);
        if (validator != address(0)) validation.registerValidator(validator, keccak256("verid-validator"));
        if (usdc != address(0)) {
            escrow = new VeridEscrow(IERC20(usdc), IVeridValidation(address(validation)), IVeridRegistry(address(registry)));
        }
        if (owner != deployer) {
            registry.transferOwnership(owner);
            validation.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console2.log("VeridRegistry  :", address(registry));
        console2.log("VeridValidation:", address(validation));
        if (address(escrow) != address(0)) console2.log("VeridEscrow    :", address(escrow));
        if (owner != deployer) {
            console2.log("NEXT: owner must call acceptOwnership() on both contracts.");
        }
    }
}
