/** Mirrors contracts/src/VeridValidation.sol. Status: 0 None, 1 Pass, 2 Fail, 3 Inconclusive. */
export const validationAbi = [
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executionKey", type: "bytes32" },
      { name: "status", type: "uint8" },
      { name: "resultHash", type: "bytes32" },
      { name: "validatorVersion", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getRecord",
    stateMutability: "view",
    inputs: [{ name: "executionKey", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "validatorId", type: "bytes32" },
          { name: "validatorVersion", type: "bytes32" },
          { name: "resultHash", type: "bytes32" },
          { name: "validator", type: "address" },
          { name: "recordedAt", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  { type: "function", name: "isPass", stateMutability: "view", inputs: [{ name: "executionKey", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "validatorIdOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bytes32" }] },
  {
    type: "function",
    name: "registerValidator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validator", type: "address" },
      { name: "validatorId", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "error", name: "NotValidator", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "AlreadyRecorded", inputs: [{ name: "executionKey", type: "bytes32" }] },
  { type: "error", name: "ZeroValue", inputs: [{ name: "field", type: "string" }] },
  { type: "error", name: "InvalidStatus", inputs: [] },
] as const;

/** Mirrors contracts/src/VeridEscrow.sol. Escrow status: 0 None, 1 Funded, 2 Released, 3 Refunded. */
export const escrowAbi = [
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executionKey", type: "bytes32" },
      { name: "payee", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [],
  },
  { type: "function", name: "release", stateMutability: "nonpayable", inputs: [{ name: "executionKey", type: "bytes32" }], outputs: [] },
  { type: "function", name: "refund", stateMutability: "nonpayable", inputs: [{ name: "executionKey", type: "bytes32" }], outputs: [] },
  {
    type: "function",
    name: "getEscrow",
    stateMutability: "view",
    inputs: [{ name: "executionKey", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "payer", type: "address" },
          { name: "deadline", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint128" },
        ],
      },
    ],
  },
  { type: "function", name: "isReleasable", stateMutability: "view", inputs: [{ name: "executionKey", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "validation", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "registry", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "event",
    name: "EscrowCreated",
    anonymous: false,
    inputs: [
      { name: "executionKey", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EscrowReleased",
    anonymous: false,
    inputs: [
      { name: "executionKey", type: "bytes32", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "triggeredBy", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EscrowRefunded",
    anonymous: false,
    inputs: [
      { name: "executionKey", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "triggeredBy", type: "address", indexed: false },
      { name: "validationFailed", type: "bool", indexed: false },
    ],
  },
  { type: "error", name: "ZeroValue", inputs: [{ name: "field", type: "string" }] },
  { type: "error", name: "AlreadyExists", inputs: [{ name: "executionKey", type: "bytes32" }] },
  { type: "error", name: "DeadlineNotInFuture", inputs: [] },
  { type: "error", name: "FeeOnTransferUnsupported", inputs: [] },
  { type: "error", name: "NotFunded", inputs: [{ name: "executionKey", type: "bytes32" }] },
  { type: "error", name: "NotReleasable", inputs: [{ name: "executionKey", type: "bytes32" }] },
  { type: "error", name: "NotRefundable", inputs: [{ name: "executionKey", type: "bytes32" }] },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

export const ESCROW_STATUS = ["none", "funded", "released", "refunded"] as const;
export type EscrowStatus = (typeof ESCROW_STATUS)[number];
