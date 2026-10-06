import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { buildReceipt, computeEvidenceRoot, hashEvidenceContent, hashResult, hashTask, hashValidationResult, verifyReceipt, type Receipt } from "@verid/core";
import { createRelayer, registryAbi, type Relayer } from "../src";
import { localChainAvailability, startLocalChain, type LocalChain } from "./anvil-harness";

// These tests start a real local EVM (anvil); allow for a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const avail = localChainAvailability();
if (!avail.ok) console.warn(`[relayer] SKIPPED — ${avail.reason}`);

describe.skipIf(!avail.ok)("createRelayer (local anvil, NOT Arc)", () => {
  let lc: LocalChain;
  let relayer: Relayer;

  beforeAll(async () => {
    lc = await startLocalChain();
    const privateKey = generatePrivateKey();
    const addr = privateKeyToAddress(privateKey);
    const rpc = lc.pub() as unknown as { request: (a: { method: string; params: unknown[] }) => Promise<unknown> };
    await rpc.request({ method: "anvil_setBalance", params: [addr, "0xde0b6b3a7640000"] });
    const tx = await lc.wallet(lc.deployer).writeContract({ address: lc.registry, abi: registryAbi, functionName: "setAnchorer", args: [addr, true] });
    await lc.pub().waitForTransactionReceipt({ hash: tx });
    relayer = createRelayer({
      rpcUrl: lc.rpc, chainId: 31337, networkName: "local-anvil", registryAddress: lc.registry, privateKey, minMaxFeePerGas: 20_000_000_000n,
    });
  }, 60_000);
  afterAll(() => lc?.stop());

  const receipt = (id: string): Receipt => {
    const ev = [0, 1].map((n) => ({ executionId: id, sequenceNumber: n, type: "tool_call" as const, timestamp: "2026-10-01T10:00:00.000Z", contentHash: hashEvidenceContent({ id, n }) }));
    return buildReceipt({
      receiptId: `r_${id}`, executionId: id, agent: { id: "a", version: "1" }, task: { hash: hashTask({ description: id }) },
      evidence: { root: computeEvidenceRoot(ev).root, count: 2 }, result: { hash: hashResult([1]) },
      validation: { status: "pass", validatorId: "v", validatorVersion: "1", resultHash: hashValidationResult({ validatorId: "v", validatorVersion: "1", executionId: id, status: "pass", checks: [], evidenceRefs: [0, 1], validatedAt: "2026-10-01T10:00:05.000Z" }) },
    });
  };

  it("exposes the public address only and reports chain status", async () => {
    expect(relayer.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(JSON.stringify(relayer)).not.toMatch(/privateKey/i);
    expect(await relayer.status()).toMatchObject({ chainId: 31337 });
  });

  it("anchors a receipt and the reader confirms it", async () => {
    const r = receipt("exec_relay_1");
    const out = await relayer.anchorer.submit(r);
    expect(out.status).toBe("confirmed");
    if (out.status !== "confirmed") return;
    const exported: Receipt = { ...r, anchor: { network: "local-anvil", chainId: 31337, registryAddress: lc.registry, transactionHash: out.txHash, blockNumber: out.blockNumber } };
    const rep = await verifyReceipt(exported, { chain: relayer.reader });
    expect(rep.checks.find((c) => c.id === "arc_tx")?.status).toBe("CONFIRMED");
    expect(rep.checks.find((c) => c.id === "onchain")?.status).toBe("MATCH");
  });

  it("when already anchored, recovers the ORIGINAL tx hash from the event log instead of resending", async () => {
    const r = receipt("exec_relay_2");
    const first = await relayer.anchorer.submit(r);
    const blockBefore = await lc.pub().getBlockNumber();
    const again = await relayer.anchorer.submit(r);
    expect(again).toMatchObject({ status: "confirmed", txHash: (first as { txHash: string }).txHash });
    expect(await lc.pub().getBlockNumber()).toBe(blockBefore); // nothing new was mined
  });

  it("a relayer that is not allowlisted is refused before spending gas", async () => {
    const stranger = createRelayer({
      rpcUrl: lc.rpc, chainId: 31337, networkName: "local-anvil", registryAddress: lc.registry, privateKey: generatePrivateKey(), minMaxFeePerGas: 20_000_000_000n,
    });
    await expect(stranger.anchorer.submit(receipt("exec_relay_3"))).rejects.toThrow();
  });
});
