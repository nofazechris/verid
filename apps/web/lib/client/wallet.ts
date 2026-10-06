"use client";

import { createPublicClient, createWalletClient, custom, defineChain, isAddress, parseUnits, type Address, type EIP1193Provider, type Hex } from "viem";
import { erc20Abi, escrowAbi } from "@verid/arc/abi-settlement";

/**
 * Browser-wallet funding for a VeridEscrow. The server never holds payer keys: the payer's own wallet signs
 * `approve` + `create`, and the server later READS the result from the chain (it never trusts this client).
 */

export interface FundingParams {
  escrowAddress: string;
  tokenAddress: string;
  chainId: number;
  network: string;
  executionKey: string;
}

export class WalletError extends Error {}

function provider(): EIP1193Provider {
  const p = (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!p) throw new WalletError("No browser wallet found. Install a wallet extension (for example MetaMask) and reload.");
  return p;
}

export const hasWallet = () => typeof globalThis !== "undefined" && !!(globalThis as unknown as { ethereum?: unknown }).ethereum;

/** Converts a decimal USDC string (6 decimals) to base units, rejecting anything ambiguous. */
export function parseUsdc(input: string): bigint {
  const t = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) throw new WalletError("Enter an amount with at most 6 decimal places, e.g. 25 or 12.5.");
  const v = parseUnits(t, 6);
  if (v <= 0n) throw new WalletError("The amount must be greater than zero.");
  if (v >= 2n ** 128n) throw new WalletError("That amount is too large.");
  return v;
}

export async function fundEscrow(
  p: FundingParams,
  input: { payee: string; amount: string; deadlineDays: number },
  onStep: (step: string) => void,
): Promise<{ payer: Address; approveTx: Hex; createTx: Hex }> {
  if (!isAddress(input.payee)) throw new WalletError("The payee must be a valid 0x address.");
  if (!Number.isInteger(input.deadlineDays) || input.deadlineDays < 1 || input.deadlineDays > 365) throw new WalletError("The deadline must be between 1 and 365 days.");
  const amount = parseUsdc(input.amount);

  const eth = provider();
  const chain = defineChain({ id: p.chainId, name: p.network, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["http://invalid.local"] } } });
  const wallet = createWalletClient({ chain, transport: custom(eth) });
  // Reads/receipts go through the wallet's own connection, so no RPC URL is shipped to the browser.
  const pub = createPublicClient({ chain, transport: custom(eth) });

  onStep("Connecting wallet…");
  const [payer] = await wallet.requestAddresses();
  if (!payer) throw new WalletError("The wallet did not provide an account.");

  const walletChain = await wallet.getChainId();
  if (walletChain !== p.chainId) {
    try {
      await wallet.switchChain({ id: p.chainId });
    } catch {
      throw new WalletError(`Switch your wallet to ${p.network} (chain ${p.chainId}) and try again. Your wallet is on chain ${walletChain}.`);
    }
  }

  const escrow = p.escrowAddress as Address;
  const token = p.tokenAddress as Address;
  const balance = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [payer] });
  if (balance < amount) throw new WalletError("Your wallet does not hold enough USDC for this amount.");

  onStep("Approve the escrow to take the USDC (wallet prompt 1 of 2)…");
  const approveTx = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [escrow, amount], account: payer, chain });
  await pub.waitForTransactionReceipt({ hash: approveTx });

  onStep("Create the escrow (wallet prompt 2 of 2)…");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + input.deadlineDays * 86_400);
  const createTx = await wallet.writeContract({
    address: escrow, abi: escrowAbi, functionName: "create", args: [p.executionKey as Hex, input.payee as Address, amount, deadline], account: payer, chain,
  });
  const rc = await pub.waitForTransactionReceipt({ hash: createTx });
  if (rc.status !== "success") throw new WalletError("The escrow transaction reverted. Nothing was transferred.");
  return { payer, approveTx, createTx };
}

/** Wallet rejections and RPC errors, in plain language. */
export function walletErrorMessage(e: unknown): string {
  if (e instanceof WalletError) return e.message;
  const any = e as { code?: number; shortMessage?: string; message?: string };
  if (any?.code === 4001 || /user rejected|denied/i.test(any?.message ?? "")) return "You declined the request in your wallet. Nothing was sent.";
  return any?.shortMessage ?? any?.message ?? "The wallet request failed.";
}
