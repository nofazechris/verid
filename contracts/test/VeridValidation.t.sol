// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VeridValidation} from "../src/VeridValidation.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VeridValidationTest is Test {
    VeridValidation val;
    address owner = makeAddr("owner");
    address validator = makeAddr("validator");
    address other = makeAddr("other");

    bytes32 constant KEY = keccak256("exec_1");
    bytes32 constant VID = keccak256("research-validator");
    bytes32 constant VER = keccak256("1.0.0");
    bytes32 constant RES = keccak256("result");

    event ValidationRecorded(
        bytes32 indexed executionKey,
        address indexed validator,
        bytes32 indexed validatorId,
        VeridValidation.Status status,
        bytes32 resultHash,
        bytes32 validatorVersion
    );

    function setUp() public {
        val = new VeridValidation(owner);
        vm.prank(owner);
        val.registerValidator(validator, VID);
    }

    function test_record_storesAndEmits() public {
        vm.warp(1_800_000_000);
        vm.expectEmit(true, true, true, true, address(val));
        emit ValidationRecorded(KEY, validator, VID, VeridValidation.Status.Pass, RES, VER);
        vm.prank(validator);
        val.record(KEY, VeridValidation.Status.Pass, RES, VER);

        VeridValidation.Record memory r = val.getRecord(KEY);
        assertEq(r.validatorId, VID);
        assertEq(r.validatorVersion, VER);
        assertEq(r.resultHash, RES);
        assertEq(r.validator, validator);
        assertEq(r.recordedAt, 1_800_000_000);
        assertEq(uint8(r.status), uint8(VeridValidation.Status.Pass));
        assertTrue(val.isPass(KEY));
    }

    function test_failAndInconclusive_areRecorded_andNotPass() public {
        vm.startPrank(validator);
        val.record(KEY, VeridValidation.Status.Fail, RES, VER);
        val.record(keccak256("exec_2"), VeridValidation.Status.Inconclusive, RES, VER);
        vm.stopPrank();
        assertFalse(val.isPass(KEY));
        assertFalse(val.isPass(keccak256("exec_2")));
        assertEq(uint8(val.getRecord(KEY).status), uint8(VeridValidation.Status.Fail));
    }

    function test_absent_isNotPass() public view {
        assertFalse(val.isPass(KEY));
        assertEq(uint8(val.getRecord(KEY).status), 0);
    }

    function test_unregistered_reverts() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.NotValidator.selector, other));
        val.record(KEY, VeridValidation.Status.Pass, RES, VER);
        assertFalse(val.isPass(KEY));
    }

    function test_owner_isNotImplicitlyValidator() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.NotValidator.selector, owner));
        val.record(KEY, VeridValidation.Status.Pass, RES, VER);
    }

    // The core "invalid transition" guarantee: an outcome can never change.
    function test_cannotOverwrite_failToPass() public {
        vm.startPrank(validator);
        val.record(KEY, VeridValidation.Status.Fail, RES, VER);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.AlreadyRecorded.selector, KEY));
        val.record(KEY, VeridValidation.Status.Pass, keccak256("other"), VER);
        vm.stopPrank();
        assertFalse(val.isPass(KEY));
        assertEq(val.getRecord(KEY).resultHash, RES);
    }

    function test_cannotOverwrite_evenFromADifferentValidator() public {
        vm.prank(validator);
        val.record(KEY, VeridValidation.Status.Fail, RES, VER);

        vm.prank(owner);
        val.registerValidator(other, keccak256("other-validator"));
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.AlreadyRecorded.selector, KEY));
        val.record(KEY, VeridValidation.Status.Pass, RES, VER);
    }

    function test_rejectsNoneAndZeroInputs() public {
        vm.startPrank(validator);
        vm.expectRevert(VeridValidation.InvalidStatus.selector);
        val.record(KEY, VeridValidation.Status.None, RES, VER);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.ZeroValue.selector, "resultHash"));
        val.record(KEY, VeridValidation.Status.Pass, bytes32(0), VER);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.ZeroValue.selector, "validatorVersion"));
        val.record(KEY, VeridValidation.Status.Pass, RES, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.ZeroValue.selector, "executionKey"));
        val.record(bytes32(0), VeridValidation.Status.Pass, RES, VER);
        vm.stopPrank();
    }

    function test_revoke_blocksFutureRecords_keepsExisting() public {
        vm.prank(validator);
        val.record(KEY, VeridValidation.Status.Pass, RES, VER);

        vm.prank(owner);
        val.revokeValidator(validator);

        vm.prank(validator);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.NotValidator.selector, validator));
        val.record(keccak256("exec_2"), VeridValidation.Status.Pass, RES, VER);
        assertTrue(val.isPass(KEY)); // prior record unaffected
    }

    function test_registry_admin() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        val.registerValidator(other, VID);

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.AlreadyRegistered.selector, validator));
        val.registerValidator(validator, VID);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.ZeroValue.selector, "validator"));
        val.registerValidator(address(0), VID);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.ZeroValue.selector, "validatorId"));
        val.registerValidator(other, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.NotRegistered.selector, other));
        val.revokeValidator(other);
        vm.stopPrank();

        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        val.revokeValidator(validator);
    }

    function test_renounceDisabled() public {
        vm.prank(owner);
        vm.expectRevert(VeridValidation.RenounceDisabled.selector);
        val.renounceOwnership();
    }

    function testFuzz_recordedOutcomeIsImmutable(bytes32 key, uint8 first, uint8 second, bytes32 h2) public {
        vm.assume(key != 0 && h2 != 0);
        VeridValidation.Status s1 = VeridValidation.Status(bound(first, 1, 3));
        VeridValidation.Status s2 = VeridValidation.Status(bound(second, 1, 3));
        vm.startPrank(validator);
        val.record(key, s1, RES, VER);
        vm.expectRevert(abi.encodeWithSelector(VeridValidation.AlreadyRecorded.selector, key));
        val.record(key, s2, h2, VER);
        vm.stopPrank();
        assertEq(uint8(val.getRecord(key).status), uint8(s1));
        assertEq(val.getRecord(key).resultHash, RES);
    }
}
