// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {VeridRegistry} from "../src/VeridRegistry.sol";
import {VeridValidation} from "../src/VeridValidation.sol";
import {VeridEscrow} from "../src/VeridEscrow.sol";

/// @dev `vm.setEnv` mutates PROCESS-GLOBAL state and Foundry runs test functions
/// in parallel, so everything that touches env vars lives in ONE test function.
contract DeployScriptTest is Test {
    function test_deployScript() public {
        address owner = makeAddr("multisig");
        address anchorer = makeAddr("relayer");

        // 1) zero addresses are rejected before anything is deployed
        vm.setEnv("VERID_OWNER", vm.toString(address(0)));
        vm.setEnv("VERID_ANCHORER", vm.toString(anchorer));
        Deploy bad = new Deploy();
        vm.expectRevert(bytes("zero address"));
        bad.run();

        // 2) happy path: deploys, configures, and STARTS a two-step ownership handoff
        vm.setEnv("VERID_OWNER", vm.toString(owner));
        vm.setEnv("VERID_ANCHORER", vm.toString(anchorer));
        Deploy d = new Deploy();
        (VeridRegistry reg, VeridValidation val, VeridEscrow esc) = d.run();
        assertEq(address(esc), address(0), "escrow only deployed when VERID_USDC is set");
        assertEq(val.validatorIdOf(makeAddr("validator")), bytes32(0));

        assertTrue(reg.isAnchorer(anchorer), "anchorer configured");
        assertEq(reg.pendingOwner(), owner, "registry handoff pending");
        assertEq(val.pendingOwner(), owner, "validation handoff pending");
        assertTrue(reg.owner() != owner, "ownership not transferred until accepted");

        vm.prank(owner);
        reg.acceptOwnership();
        vm.prank(owner);
        val.acceptOwnership();
        assertEq(reg.owner(), owner);
        assertEq(val.owner(), owner);
        // the temporary deployer retains no control
        assertTrue(reg.owner() != address(this));

        // 3) with VERID_USDC + VERID_VALIDATOR: escrow is wired to the new contracts, validator registered
        address usdc = makeAddr("usdc");
        address validator = makeAddr("validator");
        vm.setEnv("VERID_USDC", vm.toString(usdc));
        vm.setEnv("VERID_VALIDATOR", vm.toString(validator));
        Deploy d2 = new Deploy();
        (VeridRegistry reg2, VeridValidation val2, VeridEscrow esc2) = d2.run();
        assertEq(address(esc2.token()), usdc);
        assertEq(address(esc2.validation()), address(val2));
        assertEq(address(esc2.registry()), address(reg2));
        assertEq(val2.validatorIdOf(validator), keccak256("verid-validator"));
    }
}
