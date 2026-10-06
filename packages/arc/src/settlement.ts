import {
  BaseError,
  ContractFunctionRevertedError,
  WaitForTransactionReceiptTimeoutError,
  keccak256,
  stringToHex,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { executionKey, type Hex32 } from "@verid/core";
import { STATUS_TO_UINT } from "./abi";
import { ESCROW_STATUS, escrowAbi, validationAbi, type EscrowStatus } from "./abi-settlement";
import type { ArcNetwork } from "./config";

export type TxOutcome =
  | { status: "confirmed"; txHash?: Hex32; blockNumber?: number }
  | { status: "pending"; txHash: Hex32 }
  | { status: "reverted"; txHash: Hex32 };

type Wallet = WalletClient<Transport, Chain, Account>;
type Net = Pick<ArcNetwork, "chainId" | "minMaxFeePerGas">;

async function assertChain(publicClient: PublicClient, net: Net) {
  const id = await publicClient.getChainId();
  if (id !== net.chainId) throw new Error(`configured chainId ${net.chainId} but RPC reports ${id}; refusing to send a transaction`);
}

/** Fee fields that respect Arc's minimum base fee (under-priced transactions are silently dropped). */
async function fees(publicClient: PublicClient, net: Net) {
  const f = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = f.maxFeePerGas && f.maxFeePerGas > net.minMaxFeePerGas ? f.maxFeePerGas : net.minMaxFeePerGas;
  const p = f.maxPriorityFeePerGas ?? 0n;
  return { maxFeePerGas, maxPriorityFeePerGas: p > maxFeePerGas ? maxFeePerGas : p };
}

async function wait(publicClient: PublicClient, txHash: Hex32, timeoutMs: number): Promise<TxOutcome> {
  try {
    const r = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: timeoutMs });
    return r.status === "success" ? { status: "confirmed", txHash, blockNumber: Number(r.blockNumber) } : { status: "reverted", txHash };
  } catch (e) {
    if (e instanceof WaitForTransactionReceiptTimeoutError) return { status: "pending", txHash };
    throw e;
  }
}

/** True when the simulation reverted inside the contract (as opposed to an RPC/transport failure, which is rethrown). */
function isContractRevert(e: unknown): boolean {
  return e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;
}

// ------------------------------------------------------------- validation record

/** Commitment to the validator's version string (the contract stores a bytes32). */
export function validatorVersionHash(version: string): Hex32 {
  return keccak256(stringToHex(version)) as Hex32;
}

export class ValidationConflictError extends Error {
  constructor(executionId: string, detail: string) {
    super(`execution ${executionId} already has a DIFFERENT on-chain validation record (${detail}); records are write-once`);
    this.name = "ValidationConflictError";
  }
}

export interface RecordValidationInput {
  executionId: string;
  status: keyof typeof STATUS_TO_UINT;
  /** Commitment to the full validation result (hashValidationResult). */
  resultHash: Hex32;
  validatorVersion: string;
}

/**
 * Record a validation outcome on VeridValidation. IDEMPOTENT: an identical existing record is a no-op;
 * a different one throws ValidationConflictError. Must be signed by a REGISTERED validator address.
 */
export async function recordValidation(opts: {
  publicClient: PublicClient;
  walletClient: Wallet;
  validationAddress: Address;
  input: RecordValidationInput;
  network: Net;
  confirmationTimeoutMs?: number;
}): Promise<TxOutcome & { alreadyRecorded?: boolean }> {
  const { publicClient, walletClient, validationAddress, input, network } = opts;
  await assertChain(publicClient, network);
  const key = executionKey(input.executionId);
  const status = STATUS_TO_UINT[input.status];
  const version = validatorVersionHash(input.validatorVersion);

  const existing = await publicClient.readContract({ address: validationAddress, abi: validationAbi, functionName: "getRecord", args: [key] });
  if (existing.status !== 0) {
    const diffs: string[] = [];
    if (existing.status !== status) diffs.push(`status ${existing.status} vs ${status}`);
    if (existing.resultHash.toLowerCase() !== input.resultHash.toLowerCase()) diffs.push("resultHash differs");
    if (existing.validatorVersion.toLowerCase() !== version.toLowerCase()) diffs.push("validatorVersion differs");
    if (diffs.length) throw new ValidationConflictError(input.executionId, diffs.join("; "));
    return { status: "confirmed", alreadyRecorded: true };
  }

  const { request } = await publicClient.simulateContract({
    address: validationAddress,
    abi: validationAbi,
    functionName: "record",
    args: [key, status, input.resultHash, version],
    account: walletClient.account,
    ...(await fees(publicClient, network)),
  });
  const txHash = (await walletClient.writeContract(request)) as Hex32;
  return wait(publicClient, txHash, opts.confirmationTimeoutMs ?? 60_000);
}

// ------------------------------------------------------------------------ escrow

export interface OnchainEscrow {
  status: EscrowStatus;
  payer: Address;
  payee: Address;
  /** Token base units (USDC: 6 decimals) as a decimal string. */
  amount: string;
  /** Unix seconds. */
  deadline: number;
}

export async function readEscrow(publicClient: PublicClient, escrowAddress: Address, executionId: string): Promise<OnchainEscrow> {
  const e = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getEscrow", args: [executionKey(executionId)] });
  return { status: ESCROW_STATUS[e.status] ?? "none", payer: e.payer, payee: e.payee, amount: e.amount.toString(), deadline: Number(e.deadline) };
}

/** Would `release` succeed right now? (Funded AND on-chain validation Pass AND registry anchor Pass.) */
export async function canRelease(publicClient: PublicClient, escrowAddress: Address, executionId: string): Promise<boolean> {
  return publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "isReleasable", args: [executionKey(executionId)] });
}

/** Would `refund` succeed right now? Decided by simulating the real call, so this can never disagree with the contract. */
export async function canRefund(publicClient: PublicClient, escrowAddress: Address, executionId: string, account: Address): Promise<boolean> {
  try {
    await publicClient.simulateContract({ address: escrowAddress, abi: escrowAbi, functionName: "refund", args: [executionKey(executionId)], account });
    return true;
  } catch (e) {
    if (isContractRevert(e)) return false;
    throw e;
  }
}

/** Trigger `release` or `refund`. Anyone may call these; funds only ever move to the payee / payer. */
export async function settleEscrow(opts: {
  publicClient: PublicClient;
  walletClient: Wallet;
  escrowAddress: Address;
  executionId: string;
  action: "release" | "refund";
  network: Net;
  confirmationTimeoutMs?: number;
}): Promise<TxOutcome> {
  const { publicClient, walletClient, escrowAddress, executionId, action, network } = opts;
  await assertChain(publicClient, network);
  const { request } = await publicClient.simulateContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: action,
    args: [executionKey(executionId)],
    account: walletClient.account,
    ...(await fees(publicClient, network)),
  });
  const txHash = (await walletClient.writeContract(request)) as Hex32;
  return wait(publicClient, txHash, opts.confirmationTimeoutMs ?? 60_000);
}
