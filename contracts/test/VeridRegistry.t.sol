// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VeridRegistry} from "../src/VeridRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VeridRegistryTest is Test {
    VeridRegistry reg;
    address owner = makeAddr("owner");
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");

    bytes32 constant KEY = keccak256("exec_1");

    event ExecutionAnchored(
        bytes32 indexed executionKey,
        bytes32 indexed receiptHash,
        address indexed anchorer,
        bytes32 taskHash,
        bytes32 policyHash,
        bytes32 evidenceRoot,
        uint64 evidenceCount,
        bytes32 resultHash,
        VeridRegistry.ValidationStatus validationStatus,
        bytes32 validationResultHash
    );
    event AnchorerSet(address indexed anchorer, bool allowed);

    function setUp() public {
        reg = new VeridRegistry(owner);
        vm.prank(owner);
        reg.setAnchorer(relayer, true);
    }

    function _input() internal pure returns (VeridRegistry.AnchorInput memory a) {
        a = VeridRegistry.AnchorInput({
            receiptHash: keccak256("receipt"),
            taskHash: keccak256("task"),
            policyHash: keccak256("policy"),
            evidenceRoot: keccak256("evidence"),
            resultHash: keccak256("result"),
            validationResultHash: keccak256("validation"),
            evidenceCount: 12,
            validationStatus: VeridRegistry.ValidationStatus.Pass
        });
    }

    // ------------------------------------------------------------ registration

    function test_anchor_storesAllCommitments() public {
        VeridRegistry.AnchorInput memory a = _input();
        vm.prank(relayer);
        reg.anchor(KEY, a);

        VeridRegistry.Anchor memory r = reg.getAnchor(KEY);
        assertEq(r.receiptHash, a.receiptHash);
        assertEq(r.taskHash, a.taskHash);
        assertEq(r.policyHash, a.policyHash);
        assertEq(r.evidenceRoot, a.evidenceRoot);
        assertEq(r.resultHash, a.resultHash);
        assertEq(r.validationResultHash, a.validationResultHash);
        assertEq(r.evidenceCount, 12);
        assertEq(uint8(r.validationStatus), uint8(VeridRegistry.ValidationStatus.Pass));
        assertEq(r.anchorer, relayer);
        assertTrue(reg.isAnchored(KEY));
    }

    function test_anchor_emitsEvent() public {
        VeridRegistry.AnchorInput memory a = _input();
        vm.expectEmit(true, true, true, true, address(reg));
        emit ExecutionAnchored(
            KEY, a.receiptHash, relayer, a.taskHash, a.policyHash, a.evidenceRoot, a.evidenceCount, a.resultHash,
            a.validationStatus, a.validationResultHash
        );
        vm.prank(relayer);
        reg.anchor(KEY, a);
    }

    function test_anchor_allowsNoPolicy() public {
        VeridRegistry.AnchorInput memory a = _input();
        a.policyHash = bytes32(0);
        vm.prank(relayer);
        reg.anchor(KEY, a);
        assertEq(reg.getAnchor(KEY).policyHash, bytes32(0));
    }

    function test_anchor_recordsFailedValidations() public {
        // A failed validation is a legitimate, preserved record (PRD §10.6).
        VeridRegistry.AnchorInput memory a = _input();
        a.validationStatus = VeridRegistry.ValidationStatus.Fail;
        vm.prank(relayer);
        reg.anchor(KEY, a);
        assertEq(uint8(reg.getAnchor(KEY).validationStatus), uint8(VeridRegistry.ValidationStatus.Fail));
    }

    function test_absent_returnsZeroedStruct() public view {
        VeridRegistry.Anchor memory r = reg.getAnchor(KEY);
        assertEq(uint8(r.validationStatus), 0);
        assertEq(r.receiptHash, bytes32(0));
        assertFalse(reg.isAnchored(KEY));
    }

    // -------------------------------------------------------- duplicate / update

    function test_duplicate_reverts() public {
        vm.startPrank(relayer);
        reg.anchor(KEY, _input());
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.AlreadyAnchored.selector, KEY));
        reg.anchor(KEY, _input());
        vm.stopPrank();
    }

    function test_conflictingOverwrite_reverts_andOriginalIntact() public {
        VeridRegistry.AnchorInput memory a = _input();
        vm.prank(relayer);
        reg.anchor(KEY, a);

        VeridRegistry.AnchorInput memory b = _input();
        b.resultHash = keccak256("forged");
        b.validationStatus = VeridRegistry.ValidationStatus.Pass;
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.AlreadyAnchored.selector, KEY));
        reg.anchor(KEY, b);

        assertEq(reg.getAnchor(KEY).resultHash, a.resultHash);
    }

    function test_differentKeys_areIndependent() public {
        vm.startPrank(relayer);
        reg.anchor(KEY, _input());
        reg.anchor(keccak256("exec_2"), _input());
        vm.stopPrank();
        assertTrue(reg.isAnchored(keccak256("exec_2")));
    }

    // ----------------------------------------------------------- authorization

    function test_unauthorized_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.NotAnchorer.selector, stranger));
        reg.anchor(KEY, _input());
        assertFalse(reg.isAnchored(KEY));
    }

    function test_owner_isNotImplicitlyAnchorer() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.NotAnchorer.selector, owner));
        reg.anchor(KEY, _input());
    }

    function test_setAnchorer_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reg.setAnchorer(stranger, true);
    }

    function test_setAnchorer_emitsAndRejectsZero() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit AnchorerSet(stranger, true);
        vm.prank(owner);
        reg.setAnchorer(stranger, true);
        assertTrue(reg.isAnchorer(stranger));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.ZeroValue.selector, "anchorer"));
        reg.setAnchorer(address(0), true);
    }

    function test_revokedAnchorer_cannotAnchor_butPriorRecordsPersist() public {
        vm.prank(relayer);
        reg.anchor(KEY, _input());
        vm.prank(owner);
        reg.setAnchorer(relayer, false);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.NotAnchorer.selector, relayer));
        reg.anchor(keccak256("exec_2"), _input());
        assertTrue(reg.isAnchored(KEY));
    }

    function test_ownership_isTwoStep_andRenounceDisabled() public {
        address next = makeAddr("next");
        vm.prank(owner);
        reg.transferOwnership(next);
        assertEq(reg.owner(), owner); // not yet transferred
        vm.prank(next);
        reg.acceptOwnership();
        assertEq(reg.owner(), next);

        vm.prank(next);
        vm.expectRevert(VeridRegistry.RenounceDisabled.selector);
        reg.renounceOwnership();
    }

    // -------------------------------------------------------- input validation

    function test_rejectsZeroFields() public {
        string[5] memory names = ["receiptHash", "taskHash", "evidenceRoot", "resultHash", "validationResultHash"];
        for (uint256 i = 0; i < names.length; i++) {
            VeridRegistry.AnchorInput memory a = _input();
            if (i == 0) a.receiptHash = 0;
            if (i == 1) a.taskHash = 0;
            if (i == 2) a.evidenceRoot = 0;
            if (i == 3) a.resultHash = 0;
            if (i == 4) a.validationResultHash = 0;
            vm.prank(relayer);
            vm.expectRevert(abi.encodeWithSelector(VeridRegistry.ZeroValue.selector, names[i]));
            reg.anchor(KEY, a);
        }
    }

    function test_rejectsZeroKeyAndZeroCount() public {
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.ZeroValue.selector, "executionKey"));
        reg.anchor(bytes32(0), _input());

        VeridRegistry.AnchorInput memory a = _input();
        a.evidenceCount = 0;
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.ZeroValue.selector, "evidenceCount"));
        reg.anchor(KEY, a);
    }

    function test_rejectsNoneStatus() public {
        VeridRegistry.AnchorInput memory a = _input();
        a.validationStatus = VeridRegistry.ValidationStatus.None;
        vm.prank(relayer);
        vm.expectRevert(VeridRegistry.InvalidValidationStatus.selector);
        reg.anchor(KEY, a);
    }

    function test_rejectsOutOfRangeStatusAtAbiLevel() public {
        // Hand-encode status = 9, which is not a valid enum member.
        bytes memory data = abi.encodeWithSelector(
            VeridRegistry.anchor.selector,
            KEY,
            keccak256("r"), keccak256("t"), keccak256("p"), keccak256("e"), keccak256("x"), keccak256("v"),
            uint64(1),
            uint256(9)
        );
        vm.prank(relayer);
        (bool ok,) = address(reg).call(data);
        assertFalse(ok);
        assertFalse(reg.isAnchored(KEY));
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_roundTrip(
        bytes32 key,
        bytes32 receipt,
        bytes32 task,
        bytes32 policy,
        bytes32 evidenceRoot,
        bytes32 result,
        bytes32 valHash,
        uint64 count,
        uint8 statusRaw
    ) public {
        vm.assume(key != 0 && receipt != 0 && task != 0 && evidenceRoot != 0 && result != 0 && valHash != 0 && count != 0);
        VeridRegistry.ValidationStatus st = VeridRegistry.ValidationStatus(bound(statusRaw, 1, 3));
        VeridRegistry.AnchorInput memory a = VeridRegistry.AnchorInput(receipt, task, policy, evidenceRoot, result, valHash, count, st);
        vm.prank(relayer);
        reg.anchor(key, a);
        VeridRegistry.Anchor memory r = reg.getAnchor(key);
        assertEq(r.receiptHash, receipt);
        assertEq(r.taskHash, task);
        assertEq(r.policyHash, policy);
        assertEq(r.evidenceRoot, evidenceRoot);
        assertEq(r.resultHash, result);
        assertEq(r.validationResultHash, valHash);
        assertEq(r.evidenceCount, count);
        assertEq(uint8(r.validationStatus), uint8(st));
    }

    function testFuzz_nonAnchorerAlwaysReverts(address caller, bytes32 key) public {
        vm.assume(caller != relayer && key != 0);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(VeridRegistry.NotAnchorer.selector, caller));
        reg.anchor(key, _input());
    }
}
