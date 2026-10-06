/** ValidationStatus enum, as stored by VeridRegistry (0 = None / absent). */
export const STATUS_TO_UINT = { pass: 1, fail: 2, inconclusive: 3 } as const;
export const UINT_TO_STATUS = [null, "pass", "fail", "inconclusive"] as const;

const ANCHOR_INPUT_COMPONENTS = [
  { name: "receiptHash", type: "bytes32" },
  { name: "taskHash", type: "bytes32" },
  { name: "policyHash", type: "bytes32" },
  { name: "evidenceRoot", type: "bytes32" },
  { name: "resultHash", type: "bytes32" },
  { name: "validationResultHash", type: "bytes32" },
  { name: "evidenceCount", type: "uint64" },
  { name: "validationStatus", type: "uint8" },
] as const;

const ANCHOR_COMPONENTS = [
  { name: "receiptHash", type: "bytes32" },
  { name: "taskHash", type: "bytes32" },
  { name: "policyHash", type: "bytes32" },
  { name: "evidenceRoot", type: "bytes32" },
  { name: "resultHash", type: "bytes32" },
  { name: "validationResultHash", type: "bytes32" },
  { name: "anchorer", type: "address" },
  { name: "evidenceCount", type: "uint64" },
  { name: "validationStatus", type: "uint8" },
] as const;

/** Mirrors contracts/src/VeridRegistry.sol. Keep in sync; the integration test deploys the compiled contract and exercises this ABI. */
export const registryAbi = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executionKey", type: "bytes32" },
      { name: "a", type: "tuple", components: ANCHOR_INPUT_COMPONENTS },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getAnchor",
    stateMutability: "view",
    inputs: [{ name: "executionKey", type: "bytes32" }],
    outputs: [{ name: "", type: "tuple", components: ANCHOR_COMPONENTS }],
  },
  {
    type: "function",
    name: "isAnchored",
    stateMutability: "view",
    inputs: [{ name: "executionKey", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isAnchorer",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setAnchorer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anchorer", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "ExecutionAnchored",
    anonymous: false,
    inputs: [
      { name: "executionKey", type: "bytes32", indexed: true },
      { name: "receiptHash", type: "bytes32", indexed: true },
      { name: "anchorer", type: "address", indexed: true },
      { name: "taskHash", type: "bytes32", indexed: false },
      { name: "policyHash", type: "bytes32", indexed: false },
      { name: "evidenceRoot", type: "bytes32", indexed: false },
      { name: "evidenceCount", type: "uint64", indexed: false },
      { name: "resultHash", type: "bytes32", indexed: false },
      { name: "validationStatus", type: "uint8", indexed: false },
      { name: "validationResultHash", type: "bytes32", indexed: false },
    ],
  },
  { type: "error", name: "NotAnchorer", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "AlreadyAnchored", inputs: [{ name: "executionKey", type: "bytes32" }] },
  { type: "error", name: "ZeroValue", inputs: [{ name: "field", type: "string" }] },
  { type: "error", name: "InvalidValidationStatus", inputs: [] },
] as const;
