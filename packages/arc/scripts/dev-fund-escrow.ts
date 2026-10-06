/**
 * Local development helper (NOT for Arc): fund a VeridEscrow for an execution from anvil account #1 to
 * account #2, using the contracts that `pnpm dev:chain` deployed (read from apps/web/.env.local).
 *
 *   pnpm dev:fund-escrow <executionId> [amountUsdc=25] [deadlineDays=7]
 *
 * Real users do the same two calls (approve + create) from their own wallet in the dashboard.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { executionKey } from "@verid/core";
import { erc20Abi, escrowAbi } from "../src/abi-settlement";

const [executionId, amountArg = "25", daysArg = "7"] = process.argv.slice(2);
if (!executionId) {
  console.error("usage: pnpm dev:fund-escrow <executionId> [amountUsdc=25] [deadlineDays=7]");
  process.exit(64);
}
const env = Object.fromEntries(
  readFileSync(resolve(import.meta.dirname, "../../../apps/web/.env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1]!, m[2]!]),
);
const rpc = env.ARC_RPC_URL;
const escrow = env.VERID_ESCROW_ADDRESS as Address | undefined;
if (!rpc || !escrow) {
  console.error("No local escrow configured in apps/web/.env.local. Start `pnpm dev:chain` first.");
  process.exit(1);
}
if (env.ARC_CHAIN_ID !== "31337") {
  console.error(`Refusing to run: ARC_CHAIN_ID is ${env.ARC_CHAIN_ID}, this helper only works on the local anvil chain (31337).`);
  process.exit(1);
}
const chain = defineChain({ id: 31337, name: "local-anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc) });
const accounts = await (pub as unknown as { request: (a: { method: string }) => Promise<Address[]> }).request({ method: "eth_accounts" });
const [payer, payee] = [accounts[1]!, accounts[2]!];
const wallet = createWalletClient({ chain, account: payer, transport: http(rpc) });

const token = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "token" });
const amount = BigInt(Math.round(Number(amountArg) * 1_000_000)); // 6 decimals
const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(daysArg) * 86_400);
const wait = async (h: Hex) => void (await pub.waitForTransactionReceipt({ hash: h }));

await wait(await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [escrow, amount] }));
await wait(await wallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "create", args: [executionKey(executionId), payee, amount, deadline] }));
console.log(`Escrow funded: ${amountArg} dev USDC from ${payer} to be paid to ${payee} on validation + anchor. execution ${executionId}`);
