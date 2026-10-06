/**
 * Test harness: spins up a LOCAL anvil EVM and deploys the real compiled
 * VeridRegistry. This is a local development chain — NOT Arc. Used only by tests.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { registryAbi } from "../src/abi";
import { validationAbi } from "../src/abi-settlement";

export const ARTIFACT = resolve(__dirname, "../../../contracts/out/VeridRegistry.sol/VeridRegistry.json");
const env = { ...process.env, PATH: [join(homedir(), ".foundry", "bin"), process.env.PATH ?? ""].join(delimiter) };
const anvilBin = process.env.ANVIL_PATH ?? "anvil";

export function localChainAvailability(): { ok: boolean; reason: string } {
  const haveAnvil = spawnSync(anvilBin, ["--version"], { env }).status === 0;
  const haveArtifact = existsSync(ARTIFACT);
  return {
    ok: haveAnvil && haveArtifact,
    reason: `anvil: ${haveAnvil ? "ok" : "missing"}, artifact: ${haveArtifact ? "ok" : "missing (run forge build in contracts/)"}`,
  };
}

const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });

export interface LocalChain {
  rpc: string;
  registry: Address;
  deployer: Address;
  relayer: Address;
  outsider: Address;
  network: { chainId: number; minMaxFeePerGas: bigint };
  pub: () => PublicClient;
  wallet: (account: Address) => WalletClient<Transport, Chain, Account>;
  stop: () => void;
}

export async function startLocalChain(): Promise<LocalChain> {
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(anvilBin, ["--port", String(port), "--chain-id", "31337", "--silent"], { env, stdio: "ignore" });
  const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "E", symbol: "E", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = () => createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  // A JSON-RPC account (address only) is a valid viem Account for node-managed keys.
  const wallet = (account: Address) =>
    createWalletClient({ chain, account, transport: http(rpc) }) as unknown as WalletClient<Transport, Chain, Account>;

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      await pub().getChainId();
      break;
    } catch {
      if (Date.now() > deadline) {
        proc.kill();
        throw new Error("anvil did not start");
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // anvil pre-unlocks its dev accounts, so no private keys are needed.
  const accts = await (pub() as unknown as { request: (a: { method: string }) => Promise<Address[]> }).request({ method: "eth_accounts" });
  const [deployer, relayer, outsider] = [accts[0]!, accts[1]!, accts[2]!];

  const art = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const hash = await wallet(deployer).deployContract({ abi: art.abi, bytecode: art.bytecode.object as Hex, args: [deployer], chain });
  const rc = await pub().waitForTransactionReceipt({ hash });
  const registry = rc.contractAddress as Address;
  const tx = await wallet(deployer).writeContract({ address: registry, abi: registryAbi, functionName: "setAnchorer", args: [relayer, true], chain });
  await pub().waitForTransactionReceipt({ hash: tx });

  return {
    rpc, registry, deployer, relayer, outsider,
    network: { chainId: 31337, minMaxFeePerGas: 20_000_000_000n },
    pub, wallet, stop: () => void proc.kill(),
  };
}

export interface EscrowStack {
  validation: Address;
  usdc: Address;
  escrow: Address;
  validator: Address;
  payer: Address;
  payee: Address;
}

/** Deploys VeridValidation + DevUSDC + VeridEscrow next to the registry (all local, NOT Arc). */
export async function deployEscrowStack(c: LocalChain): Promise<EscrowStack> {
  const out = resolve(__dirname, "../../../contracts/out");
  const accts = await (c.pub() as unknown as { request: (a: { method: string }) => Promise<Address[]> }).request({ method: "eth_accounts" });
  const [validator, payer, payee] = [accts[3]!, accts[4]!, accts[5]!];
  const chain = c.wallet(c.deployer).chain;
  const deploy = async (file: string, name: string, args: unknown[]): Promise<Address> => {
    const art = JSON.parse(readFileSync(resolve(out, `${file}.sol/${name}.json`), "utf8"));
    const hash = await c.wallet(c.deployer).deployContract({ abi: art.abi, bytecode: art.bytecode.object as Hex, args, chain });
    return (await c.pub().waitForTransactionReceipt({ hash })).contractAddress as Address;
  };
  const validation = await deploy("VeridValidation", "VeridValidation", [c.deployer]);
  const usdc = await deploy("DevUSDC", "DevUSDC", []);
  const escrow = await deploy("VeridEscrow", "VeridEscrow", [usdc, validation, c.registry]);
  const w = c.wallet(c.deployer);
  const idHash = "0x" + "11".repeat(32);
  await c.pub().waitForTransactionReceipt({ hash: await w.writeContract({ address: validation, abi: validationAbi, functionName: "registerValidator", args: [validator, idHash as Hex], chain }) });
  const mintAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;
  await c.pub().waitForTransactionReceipt({ hash: await w.writeContract({ address: usdc, abi: mintAbi, functionName: "mint", args: [payer, 1_000_000_000n], chain }) });
  return { validation, usdc, escrow, validator, payer, payee };
}
