/**
 * End-to-end proof (PRD §26.4) on a LOCAL anvil chain (NOT Arc):
 *   run ResearchBot -> capture evidence -> validate -> receipt -> anchor on a real
 *   EVM -> export JSON -> verify with the CLI reading the chain directly.
 * Plus the deliberate failed-validation scenario (PRD §10.6).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvalidTransitionError, assertTransition, canSettle } from "@verid/core";
import { anchorReceipt } from "@verid/arc";
import { EXIT, main } from "@verid/cli";
import { localChainAvailability, startLocalChain, type LocalChain } from "../../../packages/arc/test/anvil-harness";
import { runExecution, type AnchorFn } from "../src";

const avail = localChainAvailability();
if (!avail.ok) console.warn(`[research-agent e2e] SKIPPED — ${avail.reason}`);

describe.skipIf(!avail.ok)("ResearchBot end-to-end (local anvil, NOT Arc)", () => {
  let lc: LocalChain;
  let dir: string;
  const submit = (): AnchorFn => async (receipt) => {
    const out = await anchorReceipt({
      publicClient: lc.pub(), walletClient: lc.wallet(lc.relayer), registryAddress: lc.registry, receipt, network: lc.network,
    });
    if (out.status === "confirmed" && out.txHash) return { status: "confirmed", txHash: out.txHash, blockNumber: out.blockNumber };
    if (out.status === "pending" || out.status === "reverted") return { status: out.status, txHash: out.txHash };
    throw new Error("anchor returned confirmed without a tx hash");
  };
  const target = () => ({ network: "local-anvil", chainId: 31337, registryAddress: lc.registry });

  const cli = async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  beforeAll(async () => {
    lc = await startLocalChain();
    dir = await mkdtemp(join(tmpdir(), "verid-e2e-"));
  }, 60_000);
  afterAll(async () => {
    lc?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("success: every lifecycle state is reached in order and the CLI verifies from the chain", async () => {
    const run = await runExecution({ executionId: "exec_e2e_success", scenario: "success", anchor: { target: target(), submit: submit() } });

    expect(run.states).toEqual([
      "created", "running", "evidence_captured", "awaiting_validation", "validated", "anchoring", "anchored",
    ]);
    expect(run.validation.status).toBe("pass");
    expect(run.receipt.anchor?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);

    const receiptPath = join(dir, "receipt.json");
    const bundlePath = join(dir, "bundle.json");
    await writeFile(receiptPath, JSON.stringify(run.receipt, null, 2));
    await writeFile(bundlePath, JSON.stringify(run.bundle, null, 2));

    const r = await cli(["receipt", "verify", receiptPath, "--bundle", bundlePath, "--rpc", lc.rpc, "--registry", lc.registry]);
    expect(r.err).toBe("");
    expect(r.out).toContain("VERIFICATION COMPLETE");
    expect(r.out).toMatch(/Arc transaction\s+CONFIRMED/);
    expect(r.out).toMatch(/Onchain commitments\s+MATCH/);
    expect(r.code).toBe(EXIT.VERIFIED);
  });

  it("the CLI rejects a tampered receipt file (exit 1)", async () => {
    const run = await runExecution({ executionId: "exec_e2e_tamper", scenario: "success", anchor: { target: target(), submit: submit() } });
    // Attacker edits the claimed result commitment in the exported file.
    const tampered = { ...run.receipt, result: { hash: `0x${"11".repeat(32)}` } };
    const p = join(dir, "tampered.json");
    await writeFile(p, JSON.stringify(tampered));
    const r = await cli(["receipt", "verify", p, "--rpc", lc.rpc, "--registry", lc.registry]);
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.out).toMatch(/Receipt commitment\s+INVALID/);
  });

  it("the CLI rejects modified evidence even with an authentic receipt (exit 1)", async () => {
    const run = await runExecution({ executionId: "exec_e2e_evidence", scenario: "success", anchor: { target: target(), submit: submit() } });
    const evidence = run.bundle.evidence!.map((e, i) => (i === 2 ? { ...e, contentHash: `0x${"22".repeat(32)}` as `0x${string}` } : e));
    const rp = join(dir, "r2.json");
    const bp = join(dir, "b2.json");
    await writeFile(rp, JSON.stringify(run.receipt));
    await writeFile(bp, JSON.stringify({ ...run.bundle, evidence }));
    const r = await cli(["receipt", "verify", rp, "--bundle", bp, "--rpc", lc.rpc, "--registry", lc.registry]);
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.out).toMatch(/Evidence commitment\s+INVALID/);
  });

  it("without an RPC the CLI is honest: INCOMPLETE and the anchor is not claimed verified", async () => {
    const run = await runExecution({ executionId: "exec_e2e_offline", scenario: "success", anchor: { target: target(), submit: submit() } });
    const rp = join(dir, "r3.json");
    const bp = join(dir, "b3.json");
    await writeFile(rp, JSON.stringify(run.receipt));
    await writeFile(bp, JSON.stringify(run.bundle));
    const r = await cli(["receipt", "verify", rp, "--bundle", bp]);
    expect(r.code).toBe(EXIT.INCOMPLETE);
    expect(r.out).toMatch(/Arc transaction\s+NOT_CHECKED/);
  });

  describe("deliberate failed validation (PRD §10.6)", () => {
    it("a 6-of-10 result is a REAL validator failure that is preserved, terminal and never settles", async () => {
      const failed = await runExecution({ executionId: "exec_e2e_failed", scenario: "incomplete", anchor: { target: target(), submit: submit() } });

      expect(failed.validation.status).toBe("fail");
      expect(failed.validation.checks.find((c) => c.id === "min_entries")?.explanation).toBe("found 6 qualifying entries, required 10");
      expect(failed.states.at(-1)).toBe("validation_failed");
      expect(failed.states).not.toContain("anchoring"); // never anchored: failures cannot proceed
      expect(failed.receipt.anchor).toBeUndefined();
      expect(failed.receipt.validation.status).toBe("fail"); // the failure is recorded in the receipt
      expect(canSettle("validation_failed")).toBe(false);
      expect(() => assertTransition("validation_failed", "anchoring")).toThrow(InvalidTransitionError);

      // A later successful attempt gets its OWN receipt and never overwrites the failure.
      const ok = await runExecution({ executionId: "exec_e2e_retry", scenario: "success", anchor: { target: target(), submit: submit() } });
      expect(ok.receipt.receiptId).not.toBe(failed.receipt.receiptId);
      expect(ok.receipt.receiptHash).not.toBe(failed.receipt.receiptHash);
      expect(failed.receipt.validation.status).toBe("fail");
    });

    it("the failed receipt is still independently verifiable (offline) and reports its FAIL status", async () => {
      const failed = await runExecution({ executionId: "exec_e2e_failed2", scenario: "incomplete" });
      const rp = join(dir, "rf.json");
      const bp = join(dir, "bf.json");
      await writeFile(rp, JSON.stringify(failed.receipt));
      await writeFile(bp, JSON.stringify(failed.bundle));
      const r = await cli(["receipt", "verify", rp, "--bundle", bp, "--json"]);
      const rep = JSON.parse(r.out);
      expect(rep.checks.find((c: { id: string }) => c.id === "validation").status).toBe("VALID");
      expect(rep.checks.find((c: { id: string }) => c.id === "evidence").status).toBe("VALID");
      expect(failed.receipt.validation.status).toBe("fail");
    });
  });
});
