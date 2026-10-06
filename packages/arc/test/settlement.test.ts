import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { buildReceipt, executionKey, hashEvidenceContent, hashPolicy, hashResult, hashTask, hashValidationResult, computeEvidenceRoot, type EvidenceCommitmentInput, type ValidationResult } from "@verid/core";
import { ValidationConflictError, anchorReceipt, canRefund, canRelease, erc20Abi, escrowAbi, readEscrow, recordValidation, settleEscrow } from "../src";
import { deployEscrowStack, localChainAvailability, startLocalChain, type EscrowStack, type LocalChain } from "./anvil-harness";

// These tests start a real local EVM (anvil); allow for a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const avail = localChainAvailability();
if (!avail.ok) console.warn(`[arc settlement] SKIPPED — ${avail.reason}`);

describe.skipIf(!avail.ok)("validation records + escrow settlement against a real EVM (local anvil, NOT Arc)", () => {
  let lc: LocalChain;
  let st: EscrowStack;
  const network = { chainId: 31337, minMaxFeePerGas: 20n * 1_000_000_000n };
  const pub = () => lc.pub();

  beforeAll(async () => {
    lc = await startLocalChain();
    st = await deployEscrowStack(lc);
  }, 90_000);
  afterAll(() => lc?.stop());

  function fixture(executionId: string, status: "pass" | "fail" = "pass") {
    const evidence: EvidenceCommitmentInput[] = [0, 1].map((n) => ({
      executionId, sequenceNumber: n, type: n === 1 ? ("result" as const) : ("tool_call" as const),
      timestamp: "2026-10-01T10:00:00.000Z", contentHash: hashEvidenceContent({ executionId, n }),
    }));
    const task = { description: "t", parameters: {} };
    const policy = { id: "p", version: 1, rules: {} };
    const validation: ValidationResult = {
      validatorId: "research-validator", validatorVersion: "1.0.0", executionId, status,
      checks: [{ id: "c", description: "d", ok: status === "pass", determinate: true }], evidenceRefs: [0, 1], validatedAt: "2026-10-01T10:00:05.000Z",
    };
    const resultHash = hashValidationResult(validation);
    const receipt = buildReceipt({
      receiptId: `r_${executionId}`, executionId, agent: { id: "a", version: "1" }, task: { hash: hashTask(task) },
      policy: { id: "p", hash: hashPolicy(policy) }, evidence: { root: computeEvidenceRoot(evidence).root, count: 2 },
      result: { hash: hashResult({ ok: true }) },
      validation: { status, validatorId: "research-validator", validatorVersion: "1.0.0", resultHash },
    });
    return { receipt, resultHash };
  }

  const record = (executionId: string, status: "pass" | "fail" | "inconclusive", resultHash: Hex, from: Address = st.validator) =>
    recordValidation({ publicClient: pub(), walletClient: lc.wallet(from), validationAddress: st.validation, network, input: { executionId, status, resultHash, validatorVersion: "1.0.0" } });
  const anchor = (r: ReturnType<typeof fixture>["receipt"]) =>
    anchorReceipt({ publicClient: pub(), walletClient: lc.wallet(lc.relayer), registryAddress: lc.registry, receipt: r, network });
  const wait = (hash: Hex) => pub().waitForTransactionReceipt({ hash });
  const balance = (a: Address) => pub().readContract({ address: st.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });

  async function fund(executionId: string, amount = 25_000_000n, deadline = BigInt(Math.floor(Date.now() / 1000) + 86_400)) {
    const chain = lc.wallet(st.payer).chain;
    await wait(await lc.wallet(st.payer).writeContract({ address: st.usdc, abi: erc20Abi, functionName: "approve", args: [st.escrow, amount], chain }));
    await wait(await lc.wallet(st.payer).writeContract({ address: st.escrow, abi: escrowAbi, functionName: "create", args: [executionKey(executionId), st.payee, amount, deadline], chain }));
  }
  const settle = (executionId: string, action: "release" | "refund") =>
    settleEscrow({ publicClient: pub(), walletClient: lc.wallet(lc.outsider), escrowAddress: st.escrow, executionId, action, network });

  it("records a validation idempotently and refuses a conflicting or unregistered writer", async () => {
    const { resultHash } = fixture("exec_val_1");
    expect((await record("exec_val_1", "pass", resultHash)).status).toBe("confirmed");
    const before = await pub().getBlockNumber();
    expect(await record("exec_val_1", "pass", resultHash)).toMatchObject({ status: "confirmed", alreadyRecorded: true });
    expect(await pub().getBlockNumber()).toBe(before); // no second transaction
    await expect(record("exec_val_1", "fail", resultHash)).rejects.toBeInstanceOf(ValidationConflictError);
    await expect(record("exec_val_2", "pass", resultHash, lc.outsider)).rejects.toThrow(/NotValidator|not.*validator/i);
  });

  it("pays the payee only after on-chain validation Pass AND an anchor, and never twice", async () => {
    const id = "exec_esc_pay";
    const { receipt, resultHash } = fixture(id);
    await fund(id);
    const e = await readEscrow(pub(), st.escrow, id);
    expect(e).toMatchObject({ status: "funded", amount: "25000000" });
    expect([e.payer.toLowerCase(), e.payee.toLowerCase()]).toEqual([st.payer.toLowerCase(), st.payee.toLowerCase()]);

    expect(await canRelease(pub(), st.escrow, id)).toBe(false);
    await record(id, "pass", resultHash);
    expect(await canRelease(pub(), st.escrow, id)).toBe(false); // validated but not anchored
    await expect(settle(id, "release")).rejects.toThrow();
    expect(await balance(st.payee)).toBe(0n);

    await anchor(receipt);
    expect(await canRelease(pub(), st.escrow, id)).toBe(true);
    expect(await canRefund(pub(), st.escrow, id, lc.outsider)).toBe(false); // owed to the payee
    expect((await settle(id, "release")).status).toBe("confirmed");
    expect(await balance(st.payee)).toBe(25_000_000n);
    expect((await readEscrow(pub(), st.escrow, id)).status).toBe("released");
    await expect(settle(id, "release")).rejects.toThrow();
  });

  it("refunds the payer after a recorded Fail, and a failed run can never release", async () => {
    const id = "exec_esc_fail";
    const { receipt, resultHash } = fixture(id, "fail");
    const payerBefore = await balance(st.payer);
    await fund(id, 10_000_000n);
    expect(await balance(st.payer)).toBe(payerBefore - 10_000_000n);
    expect(await canRefund(pub(), st.escrow, id, lc.outsider)).toBe(false); // nothing recorded, deadline far away
    await record(id, "fail", resultHash);
    await anchor(receipt); // even a Fail-status anchor does not enable release
    expect(await canRelease(pub(), st.escrow, id)).toBe(false);
    expect(await canRefund(pub(), st.escrow, id, lc.outsider)).toBe(true);
    expect((await settle(id, "refund")).status).toBe("confirmed");
    expect(await balance(st.payer)).toBe(payerBefore);
    expect((await readEscrow(pub(), st.escrow, id)).status).toBe("refunded");
  });

  it("refunds after the deadline when nothing was ever recorded", async () => {
    const id = "exec_esc_expire";
    const latest = (await pub().getBlock()).timestamp;
    await fund(id, 5_000_000n, latest + 3_600n);
    expect(await canRefund(pub(), st.escrow, id, lc.outsider)).toBe(false);
    const rpc = pub() as unknown as { request: (a: { method: string; params: unknown[] }) => Promise<unknown> };
    await rpc.request({ method: "evm_increaseTime", params: [7_200] });
    await rpc.request({ method: "evm_mine", params: [] });
    expect(await canRefund(pub(), st.escrow, id, lc.outsider)).toBe(true);
    expect((await settle(id, "refund")).status).toBe("confirmed");
  });
});
