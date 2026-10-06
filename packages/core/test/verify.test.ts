import { describe, expect, it } from "vitest";
import {
  buildReceipt,
  computeEvidenceRoot,
  executionKey,
  hashEvidenceContent,
  hashPolicy,
  hashResult,
  hashTask,
  hashValidationResult,
  verifyReceipt,
  type AnchorRecord,
  type ChainReader,
  type EvidenceCommitmentInput,
  type Hex32,
  type PolicyDefinition,
  type Receipt,
  type TaskDefinition,
  type TxStatus,
  type ValidationResult,
  type VerificationReport,
} from "../src";

const EXEC = "exec_demo";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const TX = `0x${"ab".repeat(32)}` as Hex32;

const task: TaskDefinition = { description: "Find 10 AI startups", parameters: { minimumResults: 10 } };
const policy: PolicyDefinition = { id: "research-policy", version: 1, rules: { maxRecords: 20 } };
const result = [{ name: "Acme", website: "https://acme.example", foundedYear: 2025, sources: ["https://s.example"] }];

const evidence: EvidenceCommitmentInput[] = [0, 1, 2].map((n) => ({
  executionId: EXEC,
  sequenceNumber: n,
  type: n === 2 ? ("result" as const) : ("tool_call" as const),
  timestamp: "2026-10-01T10:00:00.000Z",
  contentHash: hashEvidenceContent({ n }),
}));

const validation: ValidationResult = {
  validatorId: "research-validator",
  validatorVersion: "1.0.0",
  executionId: EXEC,
  status: "pass",
  checks: [{ id: "min_entries", description: "enough entries", ok: true, determinate: true }],
  evidenceRefs: [0, 1, 2],
  validatedAt: "2026-10-01T10:00:05.000Z",
};

function makeReceipt(withAnchor = true): Receipt {
  const r = buildReceipt({
    receiptId: "receipt_1",
    executionId: EXEC,
    agent: { id: "researchbot", version: "1.0.0" },
    task: { hash: hashTask(task) },
    policy: { id: policy.id, hash: hashPolicy(policy) },
    evidence: { root: computeEvidenceRoot(evidence).root, count: evidence.length },
    result: { hash: hashResult(result) },
    validation: {
      status: "pass",
      validatorId: validation.validatorId,
      validatorVersion: validation.validatorVersion,
      resultHash: hashValidationResult(validation),
    },
    timestamps: { createdAt: "2026-10-01T10:00:00.000Z" },
  });
  return withAnchor
    ? { ...r, anchor: { network: "arc-mainnet", chainId: 5042, registryAddress: REGISTRY, transactionHash: TX, blockNumber: 7 } }
    : r;
}

function anchorFor(r: Receipt): AnchorRecord {
  return {
    receiptHash: r.receiptHash as Hex32,
    taskHash: r.task.hash as Hex32,
    policyHash: r.policy!.hash as Hex32,
    evidenceRoot: r.evidence.root as Hex32,
    evidenceCount: r.evidence.count,
    resultHash: r.result.hash as Hex32,
    validationStatus: r.validation.status,
    validationResultHash: r.validation.resultHash as Hex32,
  };
}

function chain(r: Receipt, over: Partial<{ tx: TxStatus; anchor: AnchorRecord | null; chainId: number; registry: string; throws: boolean }> = {}): ChainReader {
  const boom = () => {
    throw new Error("ECONNREFUSED");
  };
  return {
    registryAddress: over.registry ?? REGISTRY,
    chainId: async () => (over.throws ? boom() : over.chainId ?? 5042),
    getTransaction: async () => (over.throws ? boom() : over.tx ?? { status: "confirmed", to: REGISTRY, blockNumber: 7 }),
    getAnchor: async (key) => {
      expect(key).toBe(executionKey(EXEC));
      return over.anchor === undefined ? anchorFor(r) : over.anchor;
    },
  };
}

const full = { task, policy, evidence, result, validation };
const status = (rep: VerificationReport, id: string) => rep.checks.find((c) => c.id === id)?.status;

describe("verifyReceipt — happy path", () => {
  it("verifies fully when all data and a matching chain are supplied", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { bundle: full, chain: chain(r) });
    expect(rep.outcome).toBe("verified");
    expect(rep.checks.map((c) => c.status)).toEqual(
      ["VALID", "VALID", "VALID", "VALID", "VALID", "VALID", "VALID", "CONFIRMED", "MATCH"],
    );
  });

  it("round-trips through JSON", async () => {
    const r = JSON.parse(JSON.stringify(makeReceipt()));
    const rep = await verifyReceipt(r, { bundle: full, chain: chain(r) });
    expect(rep.outcome).toBe("verified");
  });
});

describe("verifyReceipt — honesty about what was NOT checked", () => {
  it("offline with no bundle is incomplete, never verified", async () => {
    const rep = await verifyReceipt(makeReceipt());
    expect(rep.outcome).toBe("incomplete");
    expect(status(rep, "schema")).toBe("VALID");
    expect(status(rep, "receipt_commitment")).toBe("VALID");
    for (const id of ["task", "policy", "evidence", "result", "validation", "arc_tx", "onchain"]) {
      expect(status(rep, id)).toBe("NOT_CHECKED");
    }
  });

  it("missing evidence is NOT_CHECKED, not VALID", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { bundle: { ...full, evidence: undefined }, chain: chain(r) });
    expect(status(rep, "evidence")).toBe("NOT_CHECKED");
    expect(rep.outcome).toBe("incomplete");
  });

  it("receipt without an anchor leaves chain checks NOT_CHECKED", async () => {
    const rep = await verifyReceipt(makeReceipt(false), { bundle: full });
    expect(status(rep, "arc_tx")).toBe("NOT_CHECKED");
    expect(rep.outcome).toBe("incomplete");
  });
});

describe("verifyReceipt — tamper detection", () => {
  it("rejects a malformed receipt and skips the rest", async () => {
    const rep = await verifyReceipt({ nope: true });
    expect(rep.outcome).toBe("invalid");
    expect(status(rep, "schema")).toBe("INVALID");
    expect(status(rep, "task")).toBe("NOT_CHECKED");
  });

  it("rejects unknown extra fields (strict schema)", async () => {
    const rep = await verifyReceipt({ ...makeReceipt(), extra: 1 });
    expect(status(rep, "schema")).toBe("INVALID");
  });

  it("detects a modified committed field via the receipt commitment", async () => {
    const r = makeReceipt();
    const tampered = { ...r, evidence: { ...r.evidence, count: 99 } };
    const rep = await verifyReceipt(tampered);
    expect(status(rep, "receipt_commitment")).toBe("INVALID");
    expect(rep.outcome).toBe("invalid");
  });

  it("detects a flipped validation status even if receiptHash is recomputed-looking", async () => {
    const r = makeReceipt();
    const tampered = { ...r, validation: { ...r.validation, status: "fail" as const } };
    expect(status(await verifyReceipt(tampered), "receipt_commitment")).toBe("INVALID");
  });

  it("detects modified evidence", async () => {
    const r = makeReceipt();
    const modified = evidence.map((e, i) => (i === 1 ? { ...e, contentHash: hashEvidenceContent({ n: 666 }) } : e));
    const rep = await verifyReceipt(r, { bundle: { ...full, evidence: modified } });
    expect(status(rep, "evidence")).toBe("INVALID");
    expect(rep.outcome).toBe("invalid");
  });

  it("detects missing (dropped) evidence", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { bundle: { ...full, evidence: evidence.slice(0, 2) } });
    expect(status(rep, "evidence")).toBe("INVALID");
  });

  it("detects an incorrect result", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { bundle: { ...full, result: [{ name: "Forged" }] } });
    expect(status(rep, "result")).toBe("INVALID");
  });

  it("detects a swapped task", async () => {
    const rep = await verifyReceipt(makeReceipt(), { bundle: { ...full, task: { description: "other" } } });
    expect(status(rep, "task")).toBe("INVALID");
  });

  it("detects a validation record whose result was altered", async () => {
    const forged: ValidationResult = { ...validation, checks: [{ ...validation.checks[0]!, ok: false }] };
    const rep = await verifyReceipt(makeReceipt(), { bundle: { ...full, validation: forged } });
    expect(status(rep, "validation")).toBe("INVALID");
  });

  it("detects evidence belonging to a different execution", async () => {
    const r = makeReceipt();
    const foreign = evidence.map((e) => ({ ...e, executionId: "exec_other" }));
    const rep = await verifyReceipt(r, { bundle: { ...full, evidence: foreign } });
    expect(status(rep, "evidence")).toBe("INVALID");
  });
});

describe("verifyReceipt — chain failure modes", () => {
  it("unreachable RPC is UNAVAILABLE (not invalid, not valid)", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { bundle: full, chain: chain(r, { throws: true }) });
    expect(status(rep, "arc_tx")).toBe("UNAVAILABLE");
    expect(status(rep, "onchain")).toBe("UNAVAILABLE");
    expect(rep.outcome).toBe("incomplete");
  });

  it("pending transaction is PENDING and onchain commitments are not checked", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { bundle: full, chain: chain(r, { tx: { status: "pending" } }) });
    expect(status(rep, "arc_tx")).toBe("PENDING");
    expect(status(rep, "onchain")).toBe("NOT_CHECKED");
    expect(rep.outcome).toBe("incomplete");
  });

  it.each([["reverted"], ["not_found"]] as const)("%s transaction is INVALID", async (s) => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { bundle: full, chain: chain(r, { tx: { status: s } }) });
    expect(status(rep, "arc_tx")).toBe("INVALID");
    expect(rep.outcome).toBe("invalid");
  });

  it("rejects a transaction that targets some other contract", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, {
      bundle: full,
      chain: chain(r, { tx: { status: "confirmed", to: "0x2222222222222222222222222222222222222222" } }),
    });
    expect(status(rep, "arc_tx")).toBe("INVALID");
  });

  it("rejects a chainId or registry mismatch", async () => {
    const r = makeReceipt();
    expect(status(await verifyReceipt(r, { chain: chain(r, { chainId: 1 }) }), "arc_tx")).toBe("INVALID");
    expect(
      status(await verifyReceipt(r, { chain: chain(r, { registry: "0x3333333333333333333333333333333333333333" }) }), "arc_tx"),
    ).toBe("INVALID");
  });

  it("a plausible tx hash is not enough: onchain commitments must match", async () => {
    const r = makeReceipt();
    const lying = { ...anchorFor(r), evidenceRoot: `0x${"cd".repeat(32)}` as Hex32 };
    const rep = await verifyReceipt(r, { bundle: full, chain: chain(r, { anchor: lying }) });
    expect(status(rep, "arc_tx")).toBe("CONFIRMED");
    expect(status(rep, "onchain")).toBe("INVALID");
    expect(rep.checks.find((c) => c.id === "onchain")?.detail).toMatch(/evidenceRoot/);
    expect(rep.outcome).toBe("invalid");
  });

  it("no onchain record for the execution is INVALID", async () => {
    const r = makeReceipt();
    const rep = await verifyReceipt(r, { chain: chain(r, { anchor: null }) });
    expect(status(rep, "onchain")).toBe("INVALID");
  });

  it("receipt without a policy matches a zero onchain policy hash", async () => {
    const base = makeReceipt(false);
    const { policy: _p, ...noPolicy } = base;
    const r0 = buildReceipt({ ...(noPolicy as any), receiptId: "r0" });
    const r: Receipt = { ...r0, anchor: { network: "arc-mainnet", chainId: 5042, registryAddress: REGISTRY, transactionHash: TX } };
    const rec = { ...anchorFor(makeReceipt()), receiptHash: r.receiptHash as Hex32, policyHash: `0x${"00".repeat(32)}` as Hex32 };
    const rep = await verifyReceipt(r, { chain: chain(r, { anchor: rec }) });
    expect(status(rep, "onchain")).toBe("MATCH");
  });
});
