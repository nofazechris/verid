// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IVeridValidation {
    function isPass(bytes32 executionKey) external view returns (bool);
    function getRecord(bytes32 executionKey) external view returns (Record memory);

    // Mirrors VeridValidation.Record / Status; only the ABI shape matters here.
    struct Record {
        bytes32 validatorId;
        bytes32 validatorVersion;
        bytes32 resultHash;
        address validator;
        uint64 recordedAt;
        uint8 status; // 0 None, 1 Pass, 2 Fail, 3 Inconclusive
    }
}

interface IVeridRegistry {
    struct Anchor {
        bytes32 receiptHash;
        bytes32 taskHash;
        bytes32 policyHash;
        bytes32 evidenceRoot;
        bytes32 resultHash;
        bytes32 validationResultHash;
        address anchorer;
        uint64 evidenceCount;
        uint8 validationStatus; // 0 None, 1 Pass, 2 Fail, 3 Inconclusive
    }

    function getAnchor(bytes32 executionKey) external view returns (Anchor memory);
}

/// @title VeridEscrow
/// @notice Holds an ERC-20 (USDC on Arc; 6 decimals) for one execution and pays it to the payee only
///         after the work is (a) recorded as `Pass` on-chain in `VeridValidation` AND (b) anchored in
///         `VeridRegistry` with a `Pass` status. Release never trusts a caller-supplied flag.
///
/// Settlement rules (deterministic, no admin, no upgrade path, no pause, no fee):
///   * release(key):  anyone may call; pays the payee iff Pass-recorded AND Pass-anchored.
///   * refund(key):   anyone may call; pays the PAYER iff the validator recorded `Fail`, or the deadline
///                    has passed without the release conditions being met (incl. `Inconclusive`).
///   * Once the release conditions hold, refund is impossible, even after the deadline. Once settled,
///     an escrow can never be settled again.
///   * The payer has NO unilateral cancel: funds are committed to the validation outcome until it
///     fails or the deadline passes. That is the guarantee the payee relies on.
///
/// TRUST: the outcome is only as trustworthy as the owner-registered validator in `VeridValidation`
/// and the owner-allowlisted anchorer in `VeridRegistry`. This contract inherits both and adds none.
/// A `Pass` is a recorded claim by a designated validator, not a guarantee that the work is correct.
///
/// Token assumptions: a standard ERC-20. Fee-on-transfer / rebasing tokens are rejected at creation
/// (received amount must equal the requested amount). Intended token: USDC at the Arc system address.
contract VeridEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Escrow {
        address payer; // ┐ 20 bytes
        uint64 deadline; // │ 8 bytes, packed
        Status status; // ┘
        address payee;
        uint128 amount;
    }

    IERC20 public immutable token;
    IVeridValidation public immutable validation;
    IVeridRegistry public immutable registry;

    mapping(bytes32 executionKey => Escrow) private _escrows;

    event EscrowCreated(bytes32 indexed executionKey, address indexed payer, address indexed payee, uint256 amount, uint64 deadline);
    event EscrowReleased(bytes32 indexed executionKey, address indexed payee, uint256 amount, address triggeredBy);
    event EscrowRefunded(bytes32 indexed executionKey, address indexed payer, uint256 amount, address triggeredBy, bool validationFailed);

    error ZeroValue(string field);
    error AlreadyExists(bytes32 executionKey);
    error DeadlineNotInFuture();
    error FeeOnTransferUnsupported();
    error NotFunded(bytes32 executionKey);
    error NotReleasable(bytes32 executionKey);
    error NotRefundable(bytes32 executionKey);

    constructor(IERC20 token_, IVeridValidation validation_, IVeridRegistry registry_) {
        if (address(token_) == address(0)) revert ZeroValue("token");
        if (address(validation_) == address(0)) revert ZeroValue("validation");
        if (address(registry_) == address(0)) revert ZeroValue("registry");
        token = token_;
        validation = validation_;
        registry = registry_;
    }

    /// @notice Lock `amount` (pulled from msg.sender; requires prior approval) for `executionKey`.
    function create(bytes32 executionKey, address payee, uint128 amount, uint64 deadline) external nonReentrant {
        if (executionKey == bytes32(0)) revert ZeroValue("executionKey");
        if (payee == address(0)) revert ZeroValue("payee");
        if (amount == 0) revert ZeroValue("amount");
        if (deadline <= block.timestamp) revert DeadlineNotInFuture();
        if (_escrows[executionKey].status != Status.None) revert AlreadyExists(executionKey);

        _escrows[executionKey] =
            Escrow({payer: msg.sender, deadline: deadline, status: Status.Funded, payee: payee, amount: amount});

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - before != amount) revert FeeOnTransferUnsupported();

        emit EscrowCreated(executionKey, msg.sender, payee, amount, deadline);
    }

    /// @notice Pay the payee. Reverts unless the on-chain validation is Pass AND the anchor is Pass.
    function release(bytes32 executionKey) external nonReentrant {
        Escrow storage e = _escrows[executionKey];
        if (e.status != Status.Funded) revert NotFunded(executionKey);
        if (!_releasable(executionKey)) revert NotReleasable(executionKey);

        e.status = Status.Released; // effects before interaction
        address payee = e.payee;
        uint256 amount = e.amount;
        token.safeTransfer(payee, amount);
        emit EscrowReleased(executionKey, payee, amount, msg.sender);
    }

    /// @notice Return funds to the payer after a recorded validation Fail, or after the deadline
    ///         if the release conditions were never met.
    function refund(bytes32 executionKey) external nonReentrant {
        Escrow storage e = _escrows[executionKey];
        if (e.status != Status.Funded) revert NotFunded(executionKey);

        bool failed = validation.getRecord(executionKey).status == 2;
        bool expired = block.timestamp > e.deadline;
        // A Pass-recorded + Pass-anchored execution is owed to the payee and can never be refunded.
        if (_releasable(executionKey) || !(failed || expired)) revert NotRefundable(executionKey);

        e.status = Status.Refunded;
        address payer = e.payer;
        uint256 amount = e.amount;
        token.safeTransfer(payer, amount);
        emit EscrowRefunded(executionKey, payer, amount, msg.sender, failed);
    }

    function getEscrow(bytes32 executionKey) external view returns (Escrow memory) {
        return _escrows[executionKey];
    }

    /// @notice True iff `release` would succeed right now (given the escrow is funded).
    function isReleasable(bytes32 executionKey) external view returns (bool) {
        return _escrows[executionKey].status == Status.Funded && _releasable(executionKey);
    }

    function _releasable(bytes32 executionKey) private view returns (bool) {
        return validation.isPass(executionKey) && registry.getAnchor(executionKey).validationStatus == 1;
    }
}
