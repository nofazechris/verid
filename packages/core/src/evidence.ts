import type { JsonValue } from "./canonical";
import { canonicalize } from "./canonical";
import {
  DOMAIN,
  ZERO_HASH,
  commit,
  concatBytes,
  hex32ToBytes,
  isHex32,
  keccak,
  utf8ToBytes,
  type Hex32,
} from "./hash";

export const EVIDENCE_TYPES = [
  "task",
  "tool_call",
  "tool_result",
  "model_output",
  "artifact",
  "result",
  "validation",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Committed representation of one evidence record. */
export interface EvidenceCommitmentInput {
  executionId: string;
  sequenceNumber: number;
  type: EvidenceType;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Hash of the evidence content (see hashEvidenceContent). */
  contentHash: Hex32;
}

/** Full evidence record as exchanged by the SDK/API (superset of the commitment input). */
export interface EvidenceRecord extends EvidenceCommitmentInput {
  id?: string;
  contentReference?: string;
  /** NOT committed. Supplementary, unauthenticated metadata. */
  metadata?: Record<string, JsonValue>;
}

export function hashEvidenceContent(content: JsonValue): Hex32 {
  return commit(DOMAIN.evidenceContent, content);
}

/**
 * Leaf = keccak256(0x00 || canonicalJson({contentHash, executionId, sequenceNumber, timestamp, type})).
 * `metadata`, `contentReference` and `id` are deliberately NOT committed; see
 * docs/architecture.md ("What the evidence root does and does not bind").
 */
export function evidenceLeaf(rec: EvidenceCommitmentInput): Hex32 {
  if (!isHex32(rec.contentHash)) throw new Error("evidence contentHash must be bytes32 hex");
  if (!Number.isSafeInteger(rec.sequenceNumber) || rec.sequenceNumber < 0) {
    throw new Error("evidence sequenceNumber must be a non-negative safe integer");
  }
  const payload = canonicalize({
    contentHash: rec.contentHash,
    executionId: rec.executionId,
    sequenceNumber: rec.sequenceNumber,
    timestamp: rec.timestamp,
    type: rec.type,
  });
  return keccak(concatBytes(new Uint8Array([0x00]), utf8ToBytes(payload)));
}

function nodeHash(left: Hex32, right: Hex32): Hex32 {
  return keccak(concatBytes(new Uint8Array([0x01]), hex32ToBytes(left), hex32ToBytes(right)));
}

/**
 * Binary Merkle tree over ordered leaves. An odd node at any level is promoted
 * unchanged (never duplicated), which avoids the duplicate-leaf ambiguity of
 * naive Bitcoin-style trees. Leaves and inner nodes use distinct prefixes
 * (0x00/0x01), preventing leaf/node second-preimage confusion.
 */
export function merkleRoot(leaves: Hex32[]): Hex32 {
  if (leaves.length === 0) return ZERO_HASH;
  let level = leaves;
  while (level.length > 1) {
    const next: Hex32[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right === undefined ? left : nodeHash(left, right));
    }
    level = next;
  }
  return level[0]!;
}

export interface EvidenceRootResult {
  /** Final commitment: keccak256(0x02 || uint64be(count) || treeRoot). */
  root: Hex32;
  count: number;
  treeRoot: Hex32;
}

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

/**
 * Compute the evidence root. Records MUST be for a single execution and have
 * contiguous sequence numbers 0..n-1; they are ordered by sequence number
 * (input order is irrelevant). Anything else throws EvidenceError — an
 * incomplete or reordered evidence set must never produce a root.
 *
 * The count is bound into the final root so a prefix of the evidence can never
 * share a root with the full set.
 */
export function computeEvidenceRoot(records: EvidenceCommitmentInput[]): EvidenceRootResult {
  const sorted = [...records].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const execIds = new Set(sorted.map((r) => r.executionId));
  if (execIds.size > 1) throw new EvidenceError("evidence records belong to more than one execution");
  sorted.forEach((r, i) => {
    if (r.sequenceNumber !== i) {
      throw new EvidenceError(
        `evidence sequence must be contiguous from 0: expected ${i}, found ${r.sequenceNumber}`,
      );
    }
  });
  const treeRoot = merkleRoot(sorted.map(evidenceLeaf));
  const countBytes = new Uint8Array(8);
  new DataView(countBytes.buffer).setBigUint64(0, BigInt(sorted.length), false);
  const root = keccak(concatBytes(new Uint8Array([0x02]), countBytes, hex32ToBytes(treeRoot)));
  return { root, count: sorted.length, treeRoot };
}
