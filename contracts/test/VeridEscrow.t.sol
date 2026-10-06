// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VeridEscrow, IVeridValidation, IVeridRegistry} from "../src/VeridEscrow.sol";
import {VeridValidation} from "../src/VeridValidation.sol";
import {VeridRegistry} from "../src/VeridRegistry.sol";

/// USDC-like: 6 decimals.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Takes a 1% fee on every transfer.
contract FeeToken is MockUSDC {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// Re-enters release/refund from the token's transfer hook (ERC-777-style).
contract ReentrantToken is MockUSDC {
    VeridEscrow public target;
    bytes32 public key;
    bool public reenterRelease;
    bool public armed;

    function arm(VeridEscrow t, bytes32 k, bool release_) external {
        target = t;
        key = k;
        reenterRelease = release_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == address(target)) {
            armed = false;
            if (reenterRelease) target.release(key);
            else target.refund(key);
        }
    }
}

contract VeridEscrowTest is Test {
    MockUSDC usdc;
    VeridValidation val;
    VeridRegistry reg;
    VeridEscrow escrow;

    address owner = makeAddr("owner");
    address validator = makeAddr("validator");
    address anchorer = makeAddr("anchorer");
    address payer = makeAddr("payer");
    address payee = makeAddr("payee");
    address stranger = makeAddr("stranger");

    bytes32 constant KEY = keccak256("exec_1");
    bytes32 constant H = keccak256("h");
    uint128 constant AMOUNT = 25_000_000; // 25 USDC (6 decimals)
    uint64 deadline;

    event EscrowCreated(bytes32 indexed executionKey, address indexed payer, address indexed payee, uint256 amount, uint64 deadline);
    event EscrowReleased(bytes32 indexed executionKey, address indexed payee, uint256 amount, address triggeredBy);
    event EscrowRefunded(bytes32 indexed executionKey, address indexed payer, uint256 amount, address triggeredBy, bool validationFailed);

    function setUp() public {
        vm.warp(1_800_000_000);
        deadline = uint64(block.timestamp + 7 days);
        usdc = new MockUSDC();
        val = new VeridValidation(owner);
        reg = new VeridRegistry(owner);
        escrow = new VeridEscrow(IERC20(address(usdc)), IVeridValidation(address(val)), IVeridRegistry(address(reg)));
        vm.startPrank(owner);
        val.registerValidator(validator, keccak256("research-validator"));
        reg.setAnchorer(anchorer, true);
        vm.stopPrank();
        usdc.mint(payer, 1_000_000_000);
        vm.prank(payer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers
    function _create() internal {
        vm.prank(payer);
        escrow.create(KEY, payee, AMOUNT, deadline);
    }

    function _record(VeridValidation.Status s) internal {
        vm.prank(validator);
        val.record(KEY, s, H, H);
    }

    function _anchor(VeridRegistry.ValidationStatus s) internal {
        VeridRegistry.AnchorInput memory a = VeridRegistry.AnchorInput({
            receiptHash: H,
            taskHash: H,
            policyHash: bytes32(0),
            evidenceRoot: H,
            resultHash: H,
            validationResultHash: H,
            evidenceCount: 1,
            validationStatus: s
        });
        vm.prank(anchorer);
        reg.anchor(KEY, a);
    }

    // ------------------------------------------------------------------- create
    function test_create_locksFundsAndEmits() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowCreated(KEY, payer, payee, AMOUNT, deadline);
        _create();
        VeridEscrow.Escrow memory e = escrow.getEscrow(KEY);
        assertEq(e.payer, payer);
        assertEq(e.payee, payee);
        assertEq(e.amount, AMOUNT);
        assertEq(e.deadline, deadline);
        assertEq(uint8(e.status), uint8(VeridEscrow.Status.Funded));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_create_rejectsBadInputs() public {
        vm.startPrank(payer);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.ZeroValue.selector, "executionKey"));
        escrow.create(bytes32(0), payee, AMOUNT, deadline);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.ZeroValue.selector, "payee"));
        escrow.create(KEY, address(0), AMOUNT, deadline);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.ZeroValue.selector, "amount"));
        escrow.create(KEY, payee, 0, deadline);
        vm.expectRevert(VeridEscrow.DeadlineNotInFuture.selector);
        escrow.create(KEY, payee, AMOUNT, uint64(block.timestamp));
        vm.stopPrank();
    }

    function test_create_duplicateKeyReverts_andCannotOverwrite() public {
        _create();
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.AlreadyExists.selector, KEY));
        escrow.create(KEY, stranger, 1, deadline);
        assertEq(escrow.getEscrow(KEY).payee, payee);
    }

    function test_create_withoutAllowanceOrBalanceReverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.create(KEY, payee, AMOUNT, deadline);
        assertEq(uint8(escrow.getEscrow(KEY).status), uint8(VeridEscrow.Status.None));
    }

    function test_create_rejectsFeeOnTransferToken() public {
        FeeToken fee = new FeeToken();
        VeridEscrow e2 = new VeridEscrow(IERC20(address(fee)), IVeridValidation(address(val)), IVeridRegistry(address(reg)));
        fee.mint(payer, 1_000_000_000);
        vm.startPrank(payer);
        fee.approve(address(e2), type(uint256).max);
        vm.expectRevert(VeridEscrow.FeeOnTransferUnsupported.selector);
        e2.create(KEY, payee, AMOUNT, deadline);
        vm.stopPrank();
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.ZeroValue.selector, "token"));
        new VeridEscrow(IERC20(address(0)), IVeridValidation(address(val)), IVeridRegistry(address(reg)));
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.ZeroValue.selector, "validation"));
        new VeridEscrow(IERC20(address(usdc)), IVeridValidation(address(0)), IVeridRegistry(address(reg)));
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.ZeroValue.selector, "registry"));
        new VeridEscrow(IERC20(address(usdc)), IVeridValidation(address(val)), IVeridRegistry(address(0)));
    }

    // ------------------------------------------------------------------ release
    function test_release_paysPayee_whenPassRecordedAndAnchored() public {
        _create();
        _record(VeridValidation.Status.Pass);
        _anchor(VeridRegistry.ValidationStatus.Pass);
        assertTrue(escrow.isReleasable(KEY));

        vm.expectEmit(true, true, false, true, address(escrow));
        emit EscrowReleased(KEY, payee, AMOUNT, stranger);
        vm.prank(stranger); // anyone may trigger; funds only ever go to the payee
        escrow.release(KEY);

        assertEq(usdc.balanceOf(payee), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getEscrow(KEY).status), uint8(VeridEscrow.Status.Released));
        assertFalse(escrow.isReleasable(KEY));
    }

    function test_release_requiresValidationRecord() public {
        _create();
        _anchor(VeridRegistry.ValidationStatus.Pass); // anchored claims Pass but no on-chain validator record
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotReleasable.selector, KEY));
        escrow.release(KEY);
    }

    function test_release_requiresAnchor() public {
        _create();
        _record(VeridValidation.Status.Pass); // validated but not anchored
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotReleasable.selector, KEY));
        escrow.release(KEY);
    }

    function test_release_requiresAnchorStatusPass() public {
        _create();
        _record(VeridValidation.Status.Pass);
        _anchor(VeridRegistry.ValidationStatus.Fail); // anchor disagrees with validation record
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotReleasable.selector, KEY));
        escrow.release(KEY);
    }

    function test_release_failOrInconclusiveNeverReleases() public {
        _create();
        _record(VeridValidation.Status.Fail);
        _anchor(VeridRegistry.ValidationStatus.Fail);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotReleasable.selector, KEY));
        escrow.release(KEY);

        bytes32 key2 = keccak256("exec_2");
        vm.prank(payer);
        escrow.create(key2, payee, AMOUNT, deadline);
        vm.prank(validator);
        val.record(key2, VeridValidation.Status.Inconclusive, H, H);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotReleasable.selector, key2));
        escrow.release(key2);
    }

    function test_release_unknownEscrowReverts() public {
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotFunded.selector, KEY));
        escrow.release(KEY);
    }

    function test_release_twiceReverts() public {
        _create();
        _record(VeridValidation.Status.Pass);
        _anchor(VeridRegistry.ValidationStatus.Pass);
        escrow.release(KEY);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotFunded.selector, KEY));
        escrow.release(KEY);
    }

    function test_release_stillWorksAfterDeadline_ifConditionsMet() public {
        _create();
        _record(VeridValidation.Status.Pass);
        _anchor(VeridRegistry.ValidationStatus.Pass);
        vm.warp(deadline + 30 days);
        escrow.release(KEY);
        assertEq(usdc.balanceOf(payee), AMOUNT);
    }

    // ------------------------------------------------------------------- refund
    function test_refund_afterRecordedFail_beforeDeadline() public {
        _create();
        uint256 balBefore = usdc.balanceOf(payer);
        _record(VeridValidation.Status.Fail);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit EscrowRefunded(KEY, payer, AMOUNT, stranger, true);
        vm.prank(stranger);
        escrow.refund(KEY);

        assertEq(usdc.balanceOf(payer), balBefore + AMOUNT);
        assertEq(uint8(escrow.getEscrow(KEY).status), uint8(VeridEscrow.Status.Refunded));
    }

    function test_refund_afterDeadline_whenNothingRecorded() public {
        _create();
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotRefundable.selector, KEY));
        escrow.refund(KEY); // not failed, not expired
        vm.warp(deadline); // deadline itself is still inside the window
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotRefundable.selector, KEY));
        escrow.refund(KEY);
        vm.warp(deadline + 1);
        escrow.refund(KEY);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refund_afterDeadline_whenInconclusive() public {
        _create();
        _record(VeridValidation.Status.Inconclusive);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotRefundable.selector, KEY));
        escrow.refund(KEY); // inconclusive is not a fail; wait for the deadline
        vm.warp(deadline + 1);
        escrow.refund(KEY);
    }

    function test_refund_impossibleOncePassedAndAnchored_evenAfterDeadline() public {
        _create();
        _record(VeridValidation.Status.Pass);
        _anchor(VeridRegistry.ValidationStatus.Pass);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotRefundable.selector, KEY));
        escrow.refund(KEY);
        vm.warp(deadline + 365 days);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotRefundable.selector, KEY));
        escrow.refund(KEY);
        escrow.release(KEY);
    }

    function test_refund_afterDeadline_whenPassedButNotAnchored() public {
        _create();
        _record(VeridValidation.Status.Pass); // never anchored
        vm.warp(deadline + 1);
        escrow.refund(KEY); // release conditions never fully met
        assertEq(uint8(escrow.getEscrow(KEY).status), uint8(VeridEscrow.Status.Refunded));
    }

    function test_refund_twiceReverts_andAfterReleaseReverts() public {
        _create();
        _record(VeridValidation.Status.Fail);
        escrow.refund(KEY);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotFunded.selector, KEY));
        escrow.refund(KEY);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotFunded.selector, KEY));
        escrow.release(KEY);
    }

    function test_noUnilateralCancel_payerCannotRefundEarly() public {
        _create();
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(VeridEscrow.NotRefundable.selector, KEY));
        escrow.refund(KEY);
    }

    // --------------------------------------------------------------- reentrancy
    function test_reentrancy_duringRelease_isBlocked() public {
        ReentrantToken t = new ReentrantToken();
        VeridEscrow e2 = new VeridEscrow(IERC20(address(t)), IVeridValidation(address(val)), IVeridRegistry(address(reg)));
        t.mint(payer, AMOUNT);
        vm.startPrank(payer);
        t.approve(address(e2), type(uint256).max);
        e2.create(KEY, payee, AMOUNT, deadline);
        vm.stopPrank();
        _record(VeridValidation.Status.Pass);
        _anchor(VeridRegistry.ValidationStatus.Pass);
        t.arm(e2, KEY, true);
        vm.expectRevert(); // ReentrancyGuardReentrantCall bubbles out of the token hook
        e2.release(KEY);
        assertEq(t.balanceOf(payee), 0);
        assertEq(t.balanceOf(address(e2)), AMOUNT);
    }

    // --------------------------------------------------------------------- fuzz
    function testFuzz_fundsConservedAndPaidExactlyOnce(uint128 amount, bool pass, uint32 extra) public {
        amount = uint128(bound(amount, 1, 500_000_000));
        vm.prank(payer);
        escrow.create(KEY, payee, amount, deadline);
        if (pass) {
            _record(VeridValidation.Status.Pass);
            _anchor(VeridRegistry.ValidationStatus.Pass);
            escrow.release(KEY);
            assertEq(usdc.balanceOf(payee), amount);
        } else {
            _record(VeridValidation.Status.Fail);
            vm.warp(block.timestamp + extra);
            escrow.refund(KEY);
            assertEq(usdc.balanceOf(payee), 0);
        }
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(payer) + usdc.balanceOf(payee), 1_000_000_000);
    }
}
