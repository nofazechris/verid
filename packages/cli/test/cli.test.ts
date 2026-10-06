import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildReceipt,
  computeEvidenceRoot,
  executionKey,
  hashEvidenceContent,
  hashResult,
  hashTask,
  hashValidationResult,
  type AnchorRecord,
  type ChainReader,
  type EvidenceCommitmentInput,
  type Hex32,
  type Receipt,
  type ValidationResult,
} from "@verid/core";
import { EXIT, main, renderReport } from "../src";

const EXEC = "exec_cli";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const TX = `0x${"ab".repeat(32)}` as Hex32;

const task = { description: "cli task" };
const result = [{ name: "A" }];
const evidence: EvidenceCommitmentInput[] = [0, 1].map((n) => ({
  executionId: EXEC,
  sequenceNumber: n,
  type: "tool_call" as const,
  timestamp: "2026-10-01T10:00:00.000Z",
  contentHash: hashEvidenceContent({ n }),
}));
const validation: ValidationResult = {
  validatorId: "v",
  validatorVersion: "1",
  executionId: EXEC,
  status: "pass",
  checks: [],
  evidenceRefs: [0, 1],
  validatedAt: "2026-10-01T10:00:05.000Z",
};
const base = buildReceipt({
  receiptId: "r1",
  executionId: EXEC,
  agent: { id: "a", version: "1" },
  task: { hash: hashTask(task) },
  evidence: { root: computeEvidenceRoot(evidence).root, count: 2 },
  result: { hash: hashResult(result) },
  validation: { status: "pass", validatorId: "v", validatorVersion: "1", resultHash: hashValidationResult(validation) },
});
const anchored: Receipt = {
  ...base,
  anchor: { network: "arc-mainnet", chainId: 5042, registryAddress: REGISTRY, transactionHash: TX },
};
const bundle = { task, evidence, result, validation };

const chain: ChainReader = {
  registryAddress: REGISTRY,
  chainId: async () => 5042,
  getTransaction: async () => ({ status: "confirmed", to: REGISTRY }),
  getAnchor: async (k): Promise<AnchorRecord | null> =>
    k === executionKey(EXEC)
      ? {
          receiptHash: anchored.receiptHash as Hex32,
          taskHash: anchored.task.hash as Hex32,
          policyHash: `0x${"00".repeat(32)}` as Hex32,
          evidenceRoot: anchored.evidence.root as Hex32,
          evidenceCount: 2,
          resultHash: anchored.result.hash as Hex32,
          validationStatus: "pass",
          validationResultHash: anchored.validation.resultHash as Hex32,
        }
      : null,
};

let dir: string;
const f = (n: string) => join(dir, n);
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "verid-cli-"));
  await writeFile(f("receipt.json"), JSON.stringify(anchored));
  await writeFile(f("bundle.json"), JSON.stringify(bundle));
  await writeFile(f("tampered.json"), JSON.stringify({ ...anchored, result: { hash: `0x${"11".repeat(32)}` } }));
  await writeFile(f("bad.json"), "{not json");
});
afterAll(() => rm(dir, { recursive: true, force: true }));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
}
const run = (args: string[], deps = {}) => {
  const c = capture();
  return main(args, c.io, deps).then((code) => ({ code, out: c.out.join("\n"), err: c.err.join("\n") }));
};

describe("verid receipt verify", () => {
  it("exit 0 + COMPLETE only when everything (incl. chain) is verified", async () => {
    const r = await run(["receipt", "verify", f("receipt.json"), "--bundle", f("bundle.json")], { chain });
    expect(r.code).toBe(EXIT.VERIFIED);
    expect(r.out).toContain("VERIFICATION COMPLETE");
    expect(r.out).toMatch(/Arc transaction\s+CONFIRMED/);
    expect(r.out).toMatch(/Onchain commitments\s+MATCH/);
  });

  it("offline: exit 2 INCOMPLETE and says the anchor was NOT verified", async () => {
    const r = await run(["receipt", "verify", f("receipt.json"), "--bundle", f("bundle.json")]);
    expect(r.code).toBe(EXIT.INCOMPLETE);
    expect(r.out).toContain("VERIFICATION INCOMPLETE");
    expect(r.out).toContain("NOT_CHECKED");
    expect(r.out).toMatch(/Arc anchor was NOT verified/);
    expect(r.out).not.toContain("VERIFICATION COMPLETE");
  });

  it("without a bundle the evidence commitment is never claimed verified", async () => {
    const r = await run(["receipt", "verify", f("receipt.json")], { chain });
    expect(r.out).toMatch(/Evidence commitment\s+NOT_CHECKED/);
    expect(r.code).toBe(EXIT.INCOMPLETE);
  });

  it("rejects a tampered receipt with exit 1", async () => {
    const r = await run(["receipt", "verify", f("tampered.json"), "--bundle", f("bundle.json")], { chain });
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.out).toContain("VERIFICATION FAILED");
    expect(r.out).toMatch(/Receipt commitment\s+INVALID/);
  });

  it("rejects tampered evidence in the bundle with exit 1", async () => {
    const evil = { ...bundle, evidence: evidence.map((e, i) => (i ? { ...e, contentHash: hashEvidenceContent("x") } : e)) };
    await writeFile(f("evil.json"), JSON.stringify(evil));
    const r = await run(["receipt", "verify", f("receipt.json"), "--bundle", f("evil.json")], { chain });
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.out).toMatch(/Evidence commitment\s+INVALID/);
  });

  it("--json emits a parseable structured report", async () => {
    const r = await run(["receipt", "verify", f("receipt.json"), "--json"]);
    const rep = JSON.parse(r.out);
    expect(rep.outcome).toBe("incomplete");
    expect(rep.checks[0]).toMatchObject({ id: "schema", status: "VALID" });
  });

  it("exit 66 for unreadable / non-JSON input, 64 for bad usage", async () => {
    expect((await run(["receipt", "verify", f("nope.json")])).code).toBe(EXIT.IO);
    expect((await run(["receipt", "verify", f("bad.json")])).code).toBe(EXIT.IO);
    expect((await run(["receipt", "verify"])).code).toBe(EXIT.USAGE);
    expect((await run(["receipt", "verify", "a", "b"])).code).toBe(EXIT.USAGE);
    expect((await run(["receipt", "verify", f("receipt.json"), "--bogus"])).code).toBe(EXIT.USAGE);
    expect((await run(["wat"])).code).toBe(EXIT.USAGE);
  });

  it("never prints secrets from the receipt environment", async () => {
    process.env.DEPLOYER_PRIVATE_KEY = "0xsecret-should-never-appear";
    const r = await run(["receipt", "verify", f("receipt.json"), "--bundle", f("bundle.json")]);
    expect(r.out + r.err).not.toContain("secret-should-never-appear");
  });
});

describe("renderReport", () => {
  it("aligns columns and includes details", () => {
    const text = renderReport({
      outcome: "invalid",
      checks: [{ id: "x", label: "Short", status: "INVALID", detail: "why" }],
    });
    expect(text).toContain("Short   INVALID  (why)");
  });
});
