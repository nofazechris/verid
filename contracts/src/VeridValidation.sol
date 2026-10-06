// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title VeridValidation
/// @notice Records validation outcomes attested by registered validator addresses.
///
/// IMPORTANT: a record here means "the registered validator address <v> asserted
/// outcome <s> with result commitment <h>". It is a RECORDED CLAIM by a
/// designated validator, not proof that the validator is independent, unbiased
/// or correct, and not proof the underlying work was truthful. Validators are
/// registered by the owner, so the owner and each validator are disclosed trust
/// dependencies. Anything consuming `isPass` (e.g. an escrow) inherits them.
///
/// Records are write-once per execution key: an outcome can never be changed or
/// overwritten (no Fail -> Pass flip), and revoking a validator affects only
/// FUTURE records.
contract VeridValidation is Ownable2Step {
    enum Status {
        None,
        Pass,
        Fail,
        Inconclusive
    }

    struct Record {
        bytes32 validatorId; // id the validator was registered under (e.g. keccak("research-validator"))
        bytes32 validatorVersion; // commitment to the validator's version/ruleset
        bytes32 resultHash; // commitment to the full validation result (see @verid/core hashValidationResult)
        address validator; // ┐ packed
        uint64 recordedAt; // │ block timestamp
        Status status; // ┘
    }

    mapping(bytes32 executionKey => Record) private _records;
    /// @notice validator address => registered id (bytes32(0) = not registered)
    mapping(address => bytes32) public validatorIdOf;

    event ValidatorRegistered(address indexed validator, bytes32 indexed validatorId);
    event ValidatorRevoked(address indexed validator, bytes32 indexed validatorId);
    event ValidationRecorded(
        bytes32 indexed executionKey,
        address indexed validator,
        bytes32 indexed validatorId,
        Status status,
        bytes32 resultHash,
        bytes32 validatorVersion
    );

    error NotValidator(address caller);
    error AlreadyRecorded(bytes32 executionKey);
    error ZeroValue(string field);
    error InvalidStatus();
    error AlreadyRegistered(address validator);
    error NotRegistered(address validator);
    error RenounceDisabled();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerValidator(address validator, bytes32 validatorId) external onlyOwner {
        if (validator == address(0)) revert ZeroValue("validator");
        if (validatorId == bytes32(0)) revert ZeroValue("validatorId");
        if (validatorIdOf[validator] != bytes32(0)) revert AlreadyRegistered(validator);
        validatorIdOf[validator] = validatorId;
        emit ValidatorRegistered(validator, validatorId);
    }

    function revokeValidator(address validator) external onlyOwner {
        bytes32 id = validatorIdOf[validator];
        if (id == bytes32(0)) revert NotRegistered(validator);
        delete validatorIdOf[validator];
        emit ValidatorRevoked(validator, id);
    }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Record the validation outcome for an execution. Write-once.
    function record(bytes32 executionKey, Status status, bytes32 resultHash, bytes32 validatorVersion) external {
        bytes32 id = validatorIdOf[msg.sender];
        if (id == bytes32(0)) revert NotValidator(msg.sender);
        if (executionKey == bytes32(0)) revert ZeroValue("executionKey");
        if (resultHash == bytes32(0)) revert ZeroValue("resultHash");
        if (validatorVersion == bytes32(0)) revert ZeroValue("validatorVersion");
        if (status == Status.None || uint8(status) > uint8(Status.Inconclusive)) revert InvalidStatus();
        if (_records[executionKey].status != Status.None) revert AlreadyRecorded(executionKey);

        _records[executionKey] = Record({
            validatorId: id,
            validatorVersion: validatorVersion,
            resultHash: resultHash,
            validator: msg.sender,
            recordedAt: uint64(block.timestamp),
            status: status
        });
        emit ValidationRecorded(executionKey, msg.sender, id, status, resultHash, validatorVersion);
    }

    /// @notice Returns the record, or a zeroed struct (status == None) if absent.
    function getRecord(bytes32 executionKey) external view returns (Record memory) {
        return _records[executionKey];
    }

    /// @notice True iff a registered validator recorded `Pass` for this execution.
    function isPass(bytes32 executionKey) external view returns (bool) {
        return _records[executionKey].status == Status.Pass;
    }
}
