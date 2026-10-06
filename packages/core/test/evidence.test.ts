import { describe, expect, it } from "vitest";
import {
  EvidenceError,
  ZERO_HASH,
  computeEvidenceRoot,
  evidenceLeaf,
  hashEvidenceContent,
  merkleRoot,
  type EvidenceCommitmentInput,
} from "../src";

const ev = (n: number, over: Partial<EvidenceCommitmentInput> = {}): EvidenceCommitmentInput => ({
  executionId: "exec_1",
  sequenceNumber: n,
  type: "tool_call",
  timestamp: "2026-10-01T10:00:00.000Z",
  contentHash: hashEvidenceContent({ n }),
  ...over,
});

describe("evidence root", () => {
  it("is deterministic and independent of input order", () => {
    const recs = [ev(0), ev(1), ev(2), ev(3), ev(4)];
    const a = computeEvidenceRoot(recs);
    const b = computeEvidenceRoot([...recs].reverse());
    expect(a.root).toBe(b.root);
    expect(a.count).toBe(5);
  });

  it("changes when any committed field changes", () => {
    const base = computeEvidenceRoot([ev(0), ev(1), ev(2)]).root;
    expect(computeEvidenceRoot([ev(0), ev(1, { type: "tool_result" }), ev(2)]).root).not.toBe(base);
    expect(computeEvidenceRoot([ev(0), ev(1, { timestamp: "2026-10-01T10:00:01.000Z" }), ev(2)]).root).not.toBe(base);
    expect(computeEvidenceRoot([ev(0), ev(1, { contentHash: hashEvidenceContent({ n: 99 }) }), ev(2)]).root).not.toBe(base);
  });

  it("does not commit to metadata / contentReference / id", () => {
    const a = computeEvidenceRoot([ev(0)]).root;
    const b = computeEvidenceRoot([{ ...ev(0), metadata: { x: 1 }, contentReference: "s3://x", id: "ev_1" } as EvidenceCommitmentInput]).root;
    expect(a).toBe(b);
  });

  it("a prefix of the evidence never shares a root with the full set", () => {
    const full = computeEvidenceRoot([ev(0), ev(1), ev(2)]);
    const prefix = computeEvidenceRoot([ev(0), ev(1)]);
    expect(prefix.root).not.toBe(full.root);
  });

  it("duplicate trailing leaf is NOT equivalent to promoted odd leaf", () => {
    const l = [evidenceLeaf(ev(0)), evidenceLeaf(ev(1)), evidenceLeaf(ev(2))];
    expect(merkleRoot(l)).not.toBe(merkleRoot([...l, l[2]!]));
  });

  it("rejects gaps, duplicates and mixed executions", () => {
    expect(() => computeEvidenceRoot([ev(0), ev(2)])).toThrow(EvidenceError);
    expect(() => computeEvidenceRoot([ev(0), ev(0)])).toThrow(EvidenceError);
    expect(() => computeEvidenceRoot([ev(1)])).toThrow(EvidenceError);
    expect(() => computeEvidenceRoot([ev(0), ev(1, { executionId: "exec_2" })])).toThrow(/more than one execution/);
  });

  it("empty evidence has a defined root bound to count 0", () => {
    const r = computeEvidenceRoot([]);
    expect(r.count).toBe(0);
    expect(r.treeRoot).toBe(ZERO_HASH);
    expect(r.root).not.toBe(ZERO_HASH);
  });
});
