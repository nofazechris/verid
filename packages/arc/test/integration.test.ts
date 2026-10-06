import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPublicClient, http, type Address, type Hex } from "viem";
import {
  buildReceipt,
  computeEvidenceRoot,
  hashEvidenceContent,
  hashPolicy,
  hashResult,
  hashTask,
  hashValidationResult,
  verifyReceipt,
  type EvidenceCommitmentInput,
  type Receipt,
  type ValidationResult,
} from "@verid/core";
import { AnchorChainMismatchError, AnchorConflictError, ViemChainReader, anchorReceipt } from "../src";
import { localChainAvailability, startLocalChain, type LocalChain } from "./anvil-harness";

// These tests start a real local EVM (anvil); allow for a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const avail = localChainAvailability();
if (!avail.ok) console.warn(`[arc integration] SKIPPED — ${avail.reason}`);

describe.skipIf(!avail.ok)("anchoring against a real EVM (local anvil, NOT Arc)", () => {
  let lc: LocalChain;
  let registry: Address, relayer: Address, outsider: Address;
  const network = { chainId: 31337, minMaxFeePerGas: 20n * 1_000_000_000n };
  const pub = () => lc.pub();
  const wallet = (a: Address) => lc.wallet(a);

  beforeAll(async () => {
    lc = await startLocalChain();
    ({ registry, relayer, outsider } = lc);
  }, 60_000);

  afterAll(() => lc?.stop());

  // ------------------------------------------------------------ fixtures
  const task = { description: "Find 10 AI startups", parameters: { minimumResults: 10 } };
  const policy = { id: "research-policy", version: 1, rules: { maxRecords: 20 } };
  const result = [{ name: "Fixture Co", website: "https://fixture.example.com", foundedYear: 2025, sources: ["https://s.example.org"] }];

  function fixture(executionId: string, status: "pass" | "fail" = "pass") {
    const evidence: EvidenceCommitmentInput[] = [0, 1, 2].map((n) => ({
      executionId,
      sequenceNumber: n,
      type: n === 2 ? ("result" as const) : ("tool_call" as const),
      timestamp: "2026-10-01T10:00:00.000Z",
      contentHash: hashEvidenceContent({ executionId, n }),
    }));
    const validation: ValidationResult = {
      validatorId: "research-validator", validatorVersion: "1.0.0", executionId, status,
      checks: [{ id: "min_entries", description: "enough", ok: status === "pass", determinate: true }],
      evidenceRefs: [0, 1, 2], validatedAt: "2026-10-01T10:00:05.000Z",
    };
    const receipt = buildReceipt({
      receiptId: `receipt_${executionId}`, executionId,
      agent: { id: "researchbot", version: "1.0.0" },
      task: { hash: hashTask(task) }, policy: { id: policy.id, hash: hashPolicy(policy) },
      evidence: { root: computeEvidenceRoot(evidence).root, count: 3 },
      result: { hash: hashResult(result) },
      validation: { status, validatorId: "research-validator", validatorVersion: "1.0.0", resultHash: hashValidationResult(validation) },
    });
    return { receipt, bundle: { task, policy, evidence, result, validation } };
  }

  const anchor = (receipt: Receipt, from = relayer) =>
    anchorReceipt({ publicClient: pub(), walletClient: wallet(from), registryAddress: registry, receipt, network });
  const reader = () => new ViemChainReader(pub(), registry);
  const withAnchor = (r: Receipt, txHash: Hex, blockNumber?: number): Receipt => ({
    ...r, anchor: { network: "local-anvil", chainId: 31337, registryAddress: registry, transactionHash: txHash, blockNumber },
  });

  // --------------------------------------------------------------- tests
  it("anchors a real receipt and the verifier reports VERIFIED from chain data alone", async () => {
    const { receipt, bundle } = fixture("exec_e2e_1");
    const out = await anchor(receipt);
    expect(out.status).toBe("confirmed");
    expect(out.alreadyAnchored).toBe(false);
    if (out.status !== "confirmed" || !out.txHash) throw new Error("expected a confirmed tx");

    const exported = JSON.parse(JSON.stringify(withAnchor(receipt, out.txHash, out.blockNumber)));
    const rep = await verifyReceipt(exported, { bundle, chain: reader() });
    expect(rep.checks.map((c) => `${c.id}:${c.status}`)).toEqual([
      "schema:VALID", "receipt_commitment:VALID", "task:VALID", "policy:VALID", "evidence:VALID",
      "result:VALID", "validation:VALID", "arc_tx:CONFIRMED", "onchain:MATCH",
    ]);
    expect(rep.outcome).toBe("verified");
  });

  it("is idempotent: retrying sends no second transaction", async () => {
    const { receipt } = fixture("exec_e2e_idem");
    const first = await anchor(receipt);
    const blockBefore = await pub().getBlockNumber();
    const again = await anchor(receipt);
    expect(first.status).toBe("confirmed");
    expect(again).toMatchObject({ status: "confirmed", alreadyAnchored: true });
    expect(await pub().getBlockNumber()).toBe(blockBefore); // no new block => no new tx
  });

  it("refuses a conflicting second anchor for the same execution (immutable history)", async () => {
    const { receipt } = fixture("exec_e2e_conflict");
    await anchor(receipt);
    const forged = buildReceipt({ ...receipt, result: { hash: hashResult([{ name: "Forged" }]) } });
    await expect(anchor(forged)).rejects.toBeInstanceOf(AnchorConflictError);
  });

  it("a plausible receipt with a real tx hash but forged commitments is rejected", async () => {
    const { receipt } = fixture("exec_e2e_forged");
    const out = await anchor(receipt);
    if (out.status !== "confirmed" || !out.txHash) throw new Error("expected confirmed");
    // Attacker rewrites the result commitment and recomputes a self-consistent receiptHash,
    // but keeps the genuine transaction hash.
    const forged = withAnchor(buildReceipt({ ...receipt, result: { hash: hashResult([{ name: "Forged" }]) } }), out.txHash);
    const rep = await verifyReceipt(forged, { chain: reader() });
    expect(rep.checks.find((c) => c.id === "arc_tx")?.status).toBe("CONFIRMED");
    expect(rep.checks.find((c) => c.id === "onchain")).toMatchObject({ status: "INVALID" });
    expect(rep.outcome).toBe("invalid");
  });

  it("anchors and preserves a FAILED validation as a real record", async () => {
    const { receipt, bundle } = fixture("exec_e2e_failed", "fail");
    const out = await anchor(receipt);
    if (out.status !== "confirmed" || !out.txHash) throw new Error("expected confirmed");
    const rep = await verifyReceipt(withAnchor(receipt, out.txHash), { bundle, chain: reader() });
    expect(rep.outcome).toBe("verified"); // the FAIL record itself is authentic and consistent
    const rec = await reader().getAnchor((await import("@verid/core")).executionKey("exec_e2e_failed"));
    expect(rec?.validationStatus).toBe("fail");
  });

  it("rejects a non-allowlisted sender before spending gas", async () => {
    const { receipt } = fixture("exec_e2e_outsider");
    await expect(anchor(receipt, outsider)).rejects.toThrow(/NotAnchorer/);
    expect(await reader().getAnchor((await import("@verid/core")).executionKey("exec_e2e_outsider"))).toBeNull();
  });

  it("refuses to send when the RPC chain id differs from configuration", async () => {
    const { receipt } = fixture("exec_e2e_wrongchain");
    await expect(
      anchorReceipt({ publicClient: pub(), walletClient: wallet(relayer), registryAddress: registry, receipt, network: { ...network, chainId: 5042 } }),
    ).rejects.toBeInstanceOf(AnchorChainMismatchError);
  });

  it("reader: unknown tx -> not_found; random execution -> null", async () => {
    expect(await reader().getTransaction(`0x${"ee".repeat(32)}`)).toEqual({ status: "not_found" });
    expect(await reader().getAnchor(`0x${"01".repeat(32)}`)).toBeNull();
  });

  it("an unreachable RPC yields UNAVAILABLE, not a verdict", async () => {
    const { receipt, bundle } = fixture("exec_e2e_down");
    const out = await anchor(receipt);
    if (out.status !== "confirmed" || !out.txHash) throw new Error("expected confirmed");
    const dead = new ViemChainReader(
      createPublicClient({ transport: http("http://127.0.0.1:1", { retryCount: 0, timeout: 500 }) }),
      registry,
    );
    const rep = await verifyReceipt(withAnchor(receipt, out.txHash), { bundle, chain: dead });
    expect(rep.checks.find((c) => c.id === "arc_tx")?.status).toBe("UNAVAILABLE");
    expect(rep.outcome).toBe("incomplete");
  });

  it("a receipt anchored under a different registry address is rejected", async () => {
    const { receipt } = fixture("exec_e2e_otherreg");
    const out = await anchor(receipt);
    if (out.status !== "confirmed" || !out.txHash) throw new Error("expected confirmed");
    const other = new ViemChainReader(pub(), "0x2222222222222222222222222222222222222222");
    const rep = await verifyReceipt(withAnchor(receipt, out.txHash), { chain: other });
    expect(rep.checks.find((c) => c.id === "arc_tx")?.status).toBe("INVALID");
  });
});
