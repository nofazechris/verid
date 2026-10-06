/**
 * Read-only readiness check for Arc. Sends NO transactions and needs NO private keys.
 *
 *   pnpm arc:doctor [--network testnet|mainnet] [--deployer 0x...] [--rpc <url>]
 *
 * BEFORE deploying it checks: the RPC is alive and really is the chain you asked for, the fee floor, the USDC
 * contract (address + 6 decimals), Foundry artifacts, and that the deployer / relayer / validator hold enough gas.
 * AFTER deploying (addresses found in contracts/broadcast, or in VERID_*_ADDRESS env vars) it also checks the
 * wiring: relayer allow-listed, validator registered, escrow pointing at the right token/validation/registry,
 * and who owns what.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatEther, isAddress, type Address } from "viem";
import { registryAbi } from "../src/abi";
import { erc20Abi, escrowAbi, validationAbi } from "../src/abi-settlement";
import { ROOT, clientFor, deployedFromBroadcast, fail, loadSecrets, parseArgs, presetFor, secretsPath, short } from "./arc-lib";

const { values, network } = parseArgs(process.argv.slice(2));
const net = presetFor(network);
const client = clientFor(net, values.rpc);
const GWEI = 1_000_000_000n;

let problems = 0;
let warnings = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => (problems++, console.log(`  ✕ ${m}`));
const warn = (m: string) => (warnings++, console.log(`  ! ${m}`));
const h = (t: string) => console.log(`\n${t}`);

const ownerAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

console.log(`VERID Arc readiness: ${net.name} (expected chain ${net.chainId})${values.rpc ? `, RPC override ${values.rpc}` : `, RPC ${net.rpcUrl}`}`);

// ---------------------------------------------------------------- network
h("1. Network");
let chainId = 0;
try {
  chainId = await client.getChainId();
} catch (e) {
  fail(`could not reach the RPC: ${(e as Error).message}`);
}
if (chainId === net.chainId) ok(`chain ID ${chainId} matches`);
else fail(`RPC reports chain ${chainId} but ${network} is ${net.chainId}. Refusing to continue: this could be the wrong network.`);

const block = await client.getBlock();
const ageS = Math.max(0, Math.floor(Date.now() / 1000) - Number(block.timestamp));
if (ageS < 120) ok(`latest block #${block.number} is ${ageS}s old (chain is live)`);
else warn(`latest block #${block.number} is ${ageS}s old; the chain or RPC may be stalled`);

const fees = await client.estimateFeesPerGas();
const price = fees.maxFeePerGas ?? 0n;
const used = price > net.minMaxFeePerGas ? price : net.minMaxFeePerGas;
ok(`node suggests maxFeePerGas ${Number(price) / 1e9} gwei; Verid sends at least ${Number(net.minMaxFeePerGas) / 1e9} gwei (Arc drops cheaper transactions silently)`);

// ------------------------------------------------------------------- USDC
h("2. USDC (gas token and ERC-20 interface)");
const usdc = net.usdcAddress;
const code = await client.getCode({ address: usdc });
if (!code || code === "0x") bad(`no contract at ${usdc}; the USDC address may be wrong for this network`);
else {
  ok(`contract present at ${usdc}`);
  try {
    const dec = await client.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" });
    if (dec === 6) ok("ERC-20 interface reports 6 decimals (the native gas balance uses 18; never mix them)");
    else bad(`ERC-20 decimals() returned ${dec}, expected 6`);
  } catch {
    bad("decimals() call failed on the USDC address");
  }
}

// -------------------------------------------------------------- artifacts
h("3. Contracts build");
const art = (f: string) => resolve(ROOT, `contracts/out/${f}.sol/${f}.json`);
const missing = ["VeridRegistry", "VeridValidation", "VeridEscrow"].filter((f) => !existsSync(art(f)));
if (missing.length) bad(`missing build output for ${missing.join(", ")}: run \`forge build\` in contracts/`);
else {
  ok("VeridRegistry, VeridValidation and VeridEscrow are built");
  const size = (f: string) => (JSON.parse(readFileSync(art(f), "utf8")).deployedBytecode.object.length - 2) / 2;
  ok(`deployed sizes: ${["VeridRegistry", "VeridValidation", "VeridEscrow"].map((f) => `${f} ${size(f)}B`).join(", ")} (limit 24576B each)`);
}

// --------------------------------------------------------------- balances
h("4. Gas balances (native USDC, 18 decimals)");
const secrets = loadSecrets(network);
const deployer = values.deployer as Address | undefined;
const bal = async (label: string, a: Address, min: bigint, why: string) => {
  const b = await client.getBalance({ address: a });
  const line = `${label} ${short(a)} holds ${formatEther(b)} USDC`;
  if (b >= min) ok(line);
  else bad(`${line}: needs at least ${formatEther(min)} USDC ${why}`);
};
// A simulated run of the deploy script on Arc testnet used ~3.4M gas; allow ~4M at the fee we will actually pay.
const deployCost = 4_000_000n * used;
const opCost = 400_000n * used; // a handful of anchor/record/settle transactions
if (deployer) {
  if (!isAddress(deployer)) fail("--deployer must be a 0x address");
  await bal("deployer ", deployer, deployCost, "to deploy (~3.4M gas in a simulated run)");
} else warn("no --deployer given; pass your deployer address to check it is funded");
if (secrets) {
  await bal("relayer  ", secrets.relayerAddress, opCost, "for anchoring and settlement gas");
  await bal("validator", secrets.validatorAddress, opCost, "for validation records");
} else warn(`no server keys yet (${secretsPath(network)}): run \`pnpm arc:keys --network ${network}\``);

// ---------------------------------------------------------- deployed wiring
h("5. Deployed contracts");
const d = { ...deployedFromBroadcast(net.chainId) };
const envOr = (k: string, cur?: Address) => (process.env[k] && isAddress(process.env[k]!) ? (process.env[k] as Address) : cur);
d.registry = envOr("VERID_REGISTRY_ADDRESS", d.registry);
d.validation = envOr("VERID_VALIDATION_ADDRESS", d.validation);
d.escrow = envOr("VERID_ESCROW_ADDRESS", d.escrow);

if (!d.registry && !d.validation && !d.escrow) {
  console.log("  - nothing deployed yet on this network (no broadcast found). That is expected before your first deploy.");
} else {
  const exists = async (label: string, a?: Address) => {
    if (!a) return bad(`${label} address not found`), false;
    const c = await client.getCode({ address: a });
    if (!c || c === "0x") return bad(`${label} ${a}: no contract code`), false;
    ok(`${label} ${a}`);
    return true;
  };
  const [r, v, e] = [await exists("VeridRegistry  ", d.registry), await exists("VeridValidation", d.validation), await exists("VeridEscrow    ", d.escrow)];

  const who = async (label: string, a: Address) => {
    const [o, p] = await Promise.all([client.readContract({ address: a, abi: ownerAbi, functionName: "owner" }), client.readContract({ address: a, abi: ownerAbi, functionName: "pendingOwner" })]);
    if (p !== "0x0000000000000000000000000000000000000000") warn(`${label}: ownership handoff pending to ${p}; that address must call acceptOwnership()`);
    else ok(`${label} owner is ${o}`);
  };
  if (r) await who("registry  ", d.registry!);
  if (v) await who("validation", d.validation!);

  if (r && secrets) {
    const allowed = await client.readContract({ address: d.registry!, abi: registryAbi, functionName: "isAnchorer", args: [secrets.relayerAddress] });
    allowed ? ok("relayer is allow-listed as an anchorer") : bad("relayer is NOT an anchorer: the owner must call setAnchorer(relayer, true)");
  }
  if (v && secrets) {
    const id = await client.readContract({ address: d.validation!, abi: validationAbi, functionName: "validatorIdOf", args: [secrets.validatorAddress] });
    /^0x0+$/.test(id) ? bad("validator is NOT registered: the owner must call registerValidator(validator, id)") : ok("validator is registered");
  }
  if (e && v && r) {
    const [t, vv, rr] = await Promise.all(["token", "validation", "registry"].map((fn) => client.readContract({ address: d.escrow!, abi: escrowAbi, functionName: fn as "token" })));
    t.toLowerCase() === usdc.toLowerCase() ? ok("escrow token is the Arc USDC address") : bad(`escrow token is ${t}, expected ${usdc}`);
    vv.toLowerCase() === d.validation!.toLowerCase() ? ok("escrow reads this validation contract") : bad(`escrow validation is ${vv}`);
    rr.toLowerCase() === d.registry!.toLowerCase() ? ok("escrow reads this registry") : bad(`escrow registry is ${rr}`);
  }
}

console.log(`\n${problems === 0 ? "✓ READY" : `✕ ${problems} problem(s) to fix`}${warnings ? `  (${warnings} note${warnings > 1 ? "s" : ""})` : ""}\n`);
// Set the exit code instead of calling process.exit(): on Windows a forced exit while HTTP handles are closing can crash libuv.
process.exitCode = problems === 0 ? 0 : 1;
