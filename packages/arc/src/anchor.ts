import {
  WaitForTransactionReceiptTimeoutError,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { NO_POLICY, executionKey, type ChainReader, type Hex32, type Receipt } from "@verid/core";
import { STATUS_TO_UINT, UINT_TO_STATUS, registryAbi } from "./abi";
import type { ArcNetwork } from "./config";

export class AnchorConflictError extends Error {
  constructor(public readonly executionId: string, public readonly differences: string[]) {
    super(
      `execution ${executionId} is already anchored with DIFFERENT commitments (${differences.join("; ")}); ` +
        "registry records are immutable, create a new execution instead",
    );
    this.name = "AnchorConflictError";
  }
}

export class AnchorChainMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`configured chainId ${expected} but RPC reports ${actual}; refusing to send a transaction`);
    this.name = "AnchorChainMismatchError";
  }
}

// `type`, not `interface`: viem's arg-narrowing rejects interfaces here.
export type AnchorInputStruct = {
  receiptHash: Hex32;
  taskHash: Hex32;
  policyHash: Hex32;
  evidenceRoot: Hex32;
  resultHash: Hex32;
  validationResultHash: Hex32;
  evidenceCount: bigint;
  validationStatus: number;
}

/** Map a receipt's COMMITTED fields to the registry's AnchorInput. */
export function toAnchorInput(r: Receipt): AnchorInputStruct {
  return {
    receiptHash: r.receiptHash as Hex32,
    taskHash: r.task.hash as Hex32,
    policyHash: (r.policy?.hash ?? NO_POLICY) as Hex32,
    evidenceRoot: r.evidence.root as Hex32,
    resultHash: r.result.hash as Hex32,
    validationResultHash: r.validation.resultHash as Hex32,
    evidenceCount: BigInt(r.evidence.count),
    validationStatus: STATUS_TO_UINT[r.validation.status],
  };
}

export type AnchorOutcome =
  | { status: "confirmed"; txHash?: Hex32; blockNumber?: number; alreadyAnchored: boolean }
  | { status: "pending"; txHash: Hex32; alreadyAnchored: false }
  | { status: "reverted"; txHash: Hex32; alreadyAnchored: false };

export interface AnchorOptions {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  registryAddress: Address;
  receipt: Receipt;
  network: Pick<ArcNetwork, "chainId" | "minMaxFeePerGas">;
  /** How long to wait for inclusion before returning `pending`. Default 60s. */
  confirmationTimeoutMs?: number;
}

/**
 * Anchor a receipt's commitments on the registry. IDEMPOTENT and SAFE TO RETRY:
 *  - already anchored with identical commitments -> no transaction, returns
 *    `confirmed` + alreadyAnchored (so retries never duplicate or conflict);
 *  - already anchored with different commitments -> AnchorConflictError;
 *  - otherwise simulate (decoding reverts), send with a fee >= the network's
 *    minimum, and wait for ONE confirmation (Arc has deterministic finality).
 *
 * A timeout does NOT mean failure: it returns `pending` with the tx hash. The
 * caller must persist that hash and poll (see trackTransaction) instead of
 * resending, because resending a mined tx would revert with AlreadyAnchored.
 */
export async function anchorReceipt(opts: AnchorOptions): Promise<AnchorOutcome> {
  const { publicClient, walletClient, registryAddress, receipt, network } = opts;

  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== network.chainId) throw new AnchorChainMismatchError(network.chainId, rpcChainId);

  const key = executionKey(receipt.executionId);
  const input = toAnchorInput(receipt);

  const existing = await publicClient.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "getAnchor",
    args: [key],
  });
  if (existing.validationStatus !== 0) {
    const diffs = diffAnchor(input, existing);
    if (diffs.length) throw new AnchorConflictError(receipt.executionId, diffs);
    return { status: "confirmed", alreadyAnchored: true };
  }

  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas && fees.maxFeePerGas > network.minMaxFeePerGas ? fees.maxFeePerGas : network.minMaxFeePerGas;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;

  const { request } = await publicClient.simulateContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "anchor",
    args: [key, input],
    account: walletClient.account,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
  });
  const txHash = (await walletClient.writeContract(request)) as Hex32;

  try {
    const r = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
      timeout: opts.confirmationTimeoutMs ?? 60_000,
    });
    return r.status === "success"
      ? { status: "confirmed", txHash, blockNumber: Number(r.blockNumber), alreadyAnchored: false }
      : { status: "reverted", txHash, alreadyAnchored: false };
  } catch (e) {
    if (e instanceof WaitForTransactionReceiptTimeoutError) return { status: "pending", txHash, alreadyAnchored: false };
    throw e;
  }
}

function diffAnchor(want: AnchorInputStruct, have: {
  receiptHash: string; taskHash: string; policyHash: string; evidenceRoot: string; resultHash: string;
  validationResultHash: string; evidenceCount: bigint; validationStatus: number;
}): string[] {
  const d: string[] = [];
  const c = (n: string, a: string | bigint | number, b: string | bigint | number) => {
    if (String(a).toLowerCase() !== String(b).toLowerCase()) d.push(`${n}: ${a} vs ${b}`);
  };
  c("receiptHash", want.receiptHash, have.receiptHash);
  c("taskHash", want.taskHash, have.taskHash);
  c("policyHash", want.policyHash, have.policyHash);
  c("evidenceRoot", want.evidenceRoot, have.evidenceRoot);
  c("resultHash", want.resultHash, have.resultHash);
  c("validationResultHash", want.validationResultHash, have.validationResultHash);
  c("evidenceCount", want.evidenceCount, have.evidenceCount);
  c("validationStatus", UINT_TO_STATUS[want.validationStatus] ?? want.validationStatus, UINT_TO_STATUS[have.validationStatus] ?? have.validationStatus);
  return d;
}

export type TrackedStatus = "confirmed" | "pending" | "reverted" | "dropped";

/**
 * Classify a submitted transaction for the UI/DB. Arc silently drops
 * transactions priced below its minimum base fee, so "unknown to the node for
 * a long time" is reported as `dropped` (safe to resubmit — anchoring is
 * idempotent) rather than pending forever.
 */
export async function trackTransaction(
  reader: Pick<ChainReader, "getTransaction">,
  txHash: Hex32,
  submittedAtMs: number,
  opts: { droppedAfterMs?: number; now?: () => number } = {},
): Promise<TrackedStatus> {
  const tx = await reader.getTransaction(txHash);
  switch (tx.status) {
    case "confirmed":
      return "confirmed";
    case "reverted":
      return "reverted";
    case "pending":
      return "pending";
    case "not_found": {
      const age = (opts.now ?? Date.now)() - submittedAtMs;
      return age > (opts.droppedAfterMs ?? 120_000) ? "dropped" : "pending";
    }
  }
}
