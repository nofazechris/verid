/**
 * Local development chain. NOT Arc.
 *
 * Starts a local `anvil` EVM and deploys the compiled VeridRegistry, VeridValidation, a dev-only USDC
 * stand-in and VeridEscrow. Allowlists a freshly generated THROWAWAY relayer key (anchoring) and a
 * separate THROWAWAY validator key (on-chain validation records), both only ever valid on this local
 * chain, and writes the connection settings into apps/web/.env.local (git-ignored) so the dashboard can
 * anchor, record validations and settle escrows end to end. anvil accounts #1 and #2 are pre-funded with
 * dev USDC (use them as payer/payee, e.g. via `pnpm dev:fund-escrow`).
 *
 *   forge build            # once, in contracts/
 *   pnpm dev:chain         # leaves anvil running; Ctrl+C stops it
 *
 * Chain state is in-memory: restarting this resets it (receipts anchored on an earlier run will no
 * longer verify against the new registry). Never point this at a real network.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { registryAbi } from "../src/abi";
import { validationAbi } from "../src/abi-settlement";

const devMintAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;
const PORT = Number(process.env.DEV_CHAIN_PORT ?? 8545);
const OUT = resolve(import.meta.dirname, "../../../contracts/out");
const artifact = (file: string, name: string) => resolve(OUT, `${file}.sol/${name}.json`);
const ARTIFACT = artifact("VeridRegistry", "VeridRegistry");
const ENV_FILE = resolve(import.meta.dirname, "../../../apps/web/.env.local");
const BEGIN = "# >>> verid dev-chain (generated; local anvil, NOT Arc) >>>";
const END = "# <<< verid dev-chain <<<";

if (!existsSync(ARTIFACT)) {
  console.error(`Missing ${ARTIFACT}\nRun \`forge build\` in contracts/ first.`);
  process.exit(1);
}

const env = { ...process.env, PATH: [join(homedir(), ".foundry", "bin"), process.env.PATH ?? ""].join(delimiter) };
const anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", "31337", "--silent"], { env, stdio: "inherit" });
anvil.on("error", (e) => {
  console.error("Could not start anvil. Install Foundry (https://book.getfoundry.sh) and make sure `anvil` is on PATH.", e.message);
  process.exit(1);
});
const stop = () => {
  anvil.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const rpc = `http://127.0.0.1:${PORT}`;
const chain = defineChain({ id: 31337, name: "local-anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc) });

for (let i = 0; ; i++) {
  try {
    await pub.getChainId();
    break;
  } catch {
    if (i > 60) throw new Error("anvil did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const accounts = (await (pub as unknown as { request: (a: { method: string }) => Promise<Address[]> }).request({ method: "eth_accounts" }));
const deployer = accounts[0]!;
const wallet = createWalletClient({ chain, account: deployer, transport: http(rpc) });

const deploy = async (file: string, name: string, args: unknown[]): Promise<Address> => {
  const art = JSON.parse(readFileSync(artifact(file, name), "utf8"));
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object as Hex, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress as Address;
};
const send = async (hash: Hex) => void (await pub.waitForTransactionReceipt({ hash }));
const rpcCall = (method: string, params: unknown[]) => (pub as unknown as { request: (a: { method: string; params: unknown[] }) => Promise<unknown> }).request({ method, params });

const registry = await deploy("VeridRegistry", "VeridRegistry", [deployer]);
const validation = await deploy("VeridValidation", "VeridValidation", [deployer]);
const usdc = await deploy("DevUSDC", "DevUSDC", []);
const escrow = await deploy("VeridEscrow", "VeridEscrow", [usdc, validation, registry]);

const relayerKey = generatePrivateKey();
const relayer = privateKeyToAddress(relayerKey);
const validatorKey = generatePrivateKey();
const validator = privateKeyToAddress(validatorKey);
for (const a of [relayer, validator]) await rpcCall("anvil_setBalance", [a, "0xde0b6b3a7640000"]);
await send(await wallet.writeContract({ address: registry, abi: registryAbi, functionName: "setAnchorer", args: [relayer, true] }));
await send(await wallet.writeContract({ address: validation, abi: validationAbi, functionName: "registerValidator", args: [validator, keccak256(toHex("verid-validator"))] }));
const [payer, payee] = [accounts[1]!, accounts[2]!];
for (const a of [payer, payee]) await send(await wallet.writeContract({ address: usdc, abi: devMintAbi, functionName: "mint", args: [a, 1_000_000_000n] }));

const block = [
  BEGIN,
  `ARC_RPC_URL=${rpc}`,
  "ARC_CHAIN_ID=31337",
  "ARC_NETWORK_NAME=local-anvil",
  `VERID_REGISTRY_ADDRESS=${registry}`,
  `VERID_RELAYER_PRIVATE_KEY=${relayerKey}`,
  `VERID_VALIDATION_ADDRESS=${validation}`,
  `VERID_VALIDATOR_PRIVATE_KEY=${validatorKey}`,
  `VERID_ESCROW_ADDRESS=${escrow}`,
  END,
].join("\n");

let current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const re = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
current = current.replace(re, "").replace(/\n{3,}/g, "\n\n").trimEnd();
// An Arc block (from `pnpm arc:configure`) defines the same keys; only one chain can be active.
for (const n of ["arc-testnet", "arc-mainnet"]) {
  current = current.replace(new RegExp(`# >>> verid ${n} \\(generated by arc:configure\\) >>>[\\s\\S]*?# <<< verid ${n} <<<\\n?`), "");
}
writeFileSync(ENV_FILE, `${current}\n\n${block}\n`);

console.log(`
Local chain ready (anvil, chain id 31337, ${rpc}) — this is NOT Arc.
  registry : ${registry}
  validation: ${validation}
  escrow   : ${escrow}   (token: dev USDC ${usdc}, open mint, local only)
  relayer  : ${relayer}  (throwaway key, local only)
  validator: ${validator}  (throwaway key, local only)
  payer/payee demo accounts (anvil #1 / #2), each holding 1000 dev USDC: ${payer} / ${payee}
Wrote the connection settings to apps/web/.env.local.
RESTART the dev server (pnpm dev) to pick them up. Leave this running; Ctrl+C stops the chain.
`);
// keep the process alive; anvil is a child process
await new Promise(() => {});
