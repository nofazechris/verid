import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  type Transport,
} from "viem";
import type { AnchorRecord, ChainReader, Hex32, TxStatus } from "@verid/core";
import { UINT_TO_STATUS, registryAbi } from "./abi";
import type { ArcNetwork } from "./config";

/**
 * ChainReader backed by a real JSON-RPC endpoint (viem). This is what lets the
 * CLI verify an Arc anchor WITHOUT trusting any VERID backend: it reads the
 * transaction and the registry state straight from the chain.
 *
 * Errors from the RPC (network failures, timeouts, malformed responses) are
 * thrown, never converted into a guess. `verifyReceipt` maps a throw to
 * `UNAVAILABLE`.
 */
export class ViemChainReader implements ChainReader {
  constructor(private readonly client: PublicClient, readonly registryAddress: Address) {}

  chainId(): Promise<number> {
    return this.client.getChainId();
  }

  async getTransaction(hash: Hex32): Promise<TxStatus> {
    try {
      const r = await this.client.getTransactionReceipt({ hash });
      return r.status === "success"
        ? { status: "confirmed", to: r.to ?? undefined, blockNumber: Number(r.blockNumber) }
        : { status: "reverted" };
    } catch (e) {
      if (!(e instanceof TransactionReceiptNotFoundError)) throw e;
    }
    // No receipt: either still in the mempool (pending) or unknown to this node.
    try {
      await this.client.getTransaction({ hash });
      return { status: "pending" };
    } catch (e) {
      if (e instanceof TransactionNotFoundError) return { status: "not_found" };
      throw e;
    }
  }

  async getAnchor(executionKey: Hex32): Promise<AnchorRecord | null> {
    const r = await this.client.readContract({
      address: this.registryAddress,
      abi: registryAbi,
      functionName: "getAnchor",
      args: [executionKey],
    });
    const status = UINT_TO_STATUS[r.validationStatus];
    if (!status) return null; // status 0 = no record
    return {
      receiptHash: r.receiptHash,
      taskHash: r.taskHash,
      policyHash: r.policyHash,
      evidenceRoot: r.evidenceRoot,
      evidenceCount: Number(r.evidenceCount),
      resultHash: r.resultHash,
      validationStatus: status,
      validationResultHash: r.validationResultHash,
    };
  }
}

export function createArcReader(
  network: Pick<ArcNetwork, "rpcUrl">,
  registryAddress: Address,
  transport: Transport = http(network.rpcUrl, { timeout: 15_000, retryCount: 2 }),
): ViemChainReader {
  return new ViemChainReader(createPublicClient({ transport }), registryAddress);
}
