// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title VeridRegistry
/// @notice Append-only registry of execution commitments.
///
/// What this contract stores: cryptographic COMMITMENTS (hashes) produced off-chain
/// by VERID, never raw prompts, evidence or results. A record proves that a
/// particular set of commitments was published by an authorized anchorer at a
/// particular block. It does NOT prove the underlying claims are true; see
/// docs/architecture.md for the exact trust model.
///
/// Trust model: anchoring is restricted to an owner-managed allowlist of
/// "anchorers" (e.g. the VERID backend's relayer). This prevents third parties
/// from squatting an execution key with bogus commitments (execution IDs are
/// guessable). Anchorers are therefore a disclosed trust dependency; verifiers
/// should read `anchorer` from the record. Records are immutable once written:
/// there is no update or delete path, and a second anchor for the same key
/// reverts, so a conflicting history can never be written.
contract VeridRegistry is Ownable2Step {
    enum ValidationStatus {
        None, // 0 = no record (never valid input)
        Pass,
        Fail,
        Inconclusive
    }

    /// @dev Input struct (avoids stack-too-deep and keeps the ABI stable).
    struct AnchorInput {
        bytes32 receiptHash;
        bytes32 taskHash;
        bytes32 policyHash; // bytes32(0) means "no policy"
        bytes32 evidenceRoot;
        bytes32 resultHash;
        bytes32 validationResultHash;
        uint64 evidenceCount;
        ValidationStatus validationStatus;
    }

    struct Anchor {
        bytes32 receiptHash;
        bytes32 taskHash;
        bytes32 policyHash;
        bytes32 evidenceRoot;
        bytes32 resultHash;
        bytes32 validationResultHash;
        address anchorer; // ┐ packed into one slot
        uint64 evidenceCount; // │
        ValidationStatus validationStatus; // ┘
    }

    mapping(bytes32 executionKey => Anchor) private _anchors;
    mapping(address => bool) public isAnchorer;

    event ExecutionAnchored(
        bytes32 indexed executionKey,
        bytes32 indexed receiptHash,
        address indexed anchorer,
        bytes32 taskHash,
        bytes32 policyHash,
        bytes32 evidenceRoot,
        uint64 evidenceCount,
        bytes32 resultHash,
        ValidationStatus validationStatus,
        bytes32 validationResultHash
    );
    event AnchorerSet(address indexed anchorer, bool allowed);

    error NotAnchorer(address caller);
    error AlreadyAnchored(bytes32 executionKey);
    error ZeroValue(string field);
    error InvalidValidationStatus();
    error RenounceDisabled();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ------------------------------------------------------------------ admin

    function setAnchorer(address anchorer, bool allowed) external onlyOwner {
        if (anchorer == address(0)) revert ZeroValue("anchorer");
        isAnchorer[anchorer] = allowed;
        emit AnchorerSet(anchorer, allowed);
    }

    /// @dev Renouncing would permanently freeze the allowlist; disabled.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ----------------------------------------------------------------- anchor

    /// @notice Publish commitments for an execution. Reverts if the key was already anchored.
    /// @param executionKey keccak256(domain || 0x00 || executionId), see @verid/core `executionKey`.
    function anchor(bytes32 executionKey, AnchorInput calldata a) external {
        if (!isAnchorer[msg.sender]) revert NotAnchorer(msg.sender);
        if (executionKey == bytes32(0)) revert ZeroValue("executionKey");
        if (_anchors[executionKey].validationStatus != ValidationStatus.None) revert AlreadyAnchored(executionKey);

        if (a.receiptHash == bytes32(0)) revert ZeroValue("receiptHash");
        if (a.taskHash == bytes32(0)) revert ZeroValue("taskHash");
        if (a.evidenceRoot == bytes32(0)) revert ZeroValue("evidenceRoot");
        if (a.resultHash == bytes32(0)) revert ZeroValue("resultHash");
        if (a.validationResultHash == bytes32(0)) revert ZeroValue("validationResultHash");
        if (a.evidenceCount == 0) revert ZeroValue("evidenceCount");
        if (a.validationStatus == ValidationStatus.None || uint8(a.validationStatus) > uint8(ValidationStatus.Inconclusive)) {
            revert InvalidValidationStatus();
        }

        _anchors[executionKey] = Anchor({
            receiptHash: a.receiptHash,
            taskHash: a.taskHash,
            policyHash: a.policyHash,
            evidenceRoot: a.evidenceRoot,
            resultHash: a.resultHash,
            validationResultHash: a.validationResultHash,
            anchorer: msg.sender,
            evidenceCount: a.evidenceCount,
            validationStatus: a.validationStatus
        });

        emit ExecutionAnchored(
            executionKey,
            a.receiptHash,
            msg.sender,
            a.taskHash,
            a.policyHash,
            a.evidenceRoot,
            a.evidenceCount,
            a.resultHash,
            a.validationStatus,
            a.validationResultHash
        );
    }

    // ------------------------------------------------------------------- read

    /// @notice Returns the anchor, or a zeroed struct (validationStatus == None) if absent.
    /// @dev Absence is signalled by value rather than revert so RPC clients can
    ///      distinguish "no record" from "call failed".
    function getAnchor(bytes32 executionKey) external view returns (Anchor memory) {
        return _anchors[executionKey];
    }

    function isAnchored(bytes32 executionKey) external view returns (bool) {
        return _anchors[executionKey].validationStatus != ValidationStatus.None;
    }
}
