import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalize } from "./canonical";

/** A 32-byte value as 0x-prefixed lowercase hex (66 chars). */
export type Hex32 = `0x${string}`;

export const ZERO_HASH: Hex32 = `0x${"00".repeat(32)}`;
const HEX32_RE = /^0x[0-9a-f]{64}$/;

export function isHex32(value: unknown): value is Hex32 {
  return typeof value === "string" && HEX32_RE.test(value);
}

export function keccak(data: Uint8Array): Hex32 {
  return `0x${bytesToHex(keccak_256(data))}`;
}

export function hex32ToBytes(hex: Hex32): Uint8Array {
  if (!isHex32(hex)) throw new Error(`invalid bytes32 hex: ${String(hex)}`);
  return hexToBytes(hex.slice(2));
}

/**
 * Domain separation tags. Every commitment type hashes under its own tag so a
 * value committed as one kind of object can never be confused with another
 * (e.g. a task hash can never collide with a policy hash by construction).
 * Bumping the `/vN` suffix is a breaking change to the commitment scheme.
 */
export const DOMAIN = {
  task: "VERID/task/v1",
  policy: "VERID/policy/v1",
  evidenceContent: "VERID/evidence-content/v1",
  result: "VERID/result/v1",
  validation: "VERID/validation/v1",
  receipt: "VERID/receipt/v1",
  executionId: "VERID/execution-id/v1",
  validatorRules: "VERID/validator-rules/v1",
} as const;
export type Domain = (typeof DOMAIN)[keyof typeof DOMAIN];

/**
 * keccak256(utf8(domain) || 0x00 || utf8(canonicalJson(value))).
 * The 0x00 separator cannot appear inside the tag, so (tag, payload) pairs
 * are unambiguous.
 */
export function commit(domain: Domain, value: unknown): Hex32 {
  return keccak(concatBytes(utf8ToBytes(domain), new Uint8Array([0]), utf8ToBytes(canonicalize(value))));
}

export { concatBytes, utf8ToBytes };
