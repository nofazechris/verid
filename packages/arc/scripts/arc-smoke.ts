/**
 * End-to-end proof that Verid works on a REAL Arc network, using your deployed contracts and server keys.
 * It sends real transactions (a few cents of gas on testnet).
 *
 *   pnpm arc:smoke [--network testnet|mainnet] [--escrow] [--mainnet-i-am-sure]
 *
 *  1. validator records a Pass on VeridValidation        (write-once, idempotent)
 *  2. relayer anchors a synthetic receipt on VeridRegistry
 *  3. the receipt is verified by reading the CHAIN ONLY (no Verid server involved)
 *  4. with --escrow: relayer locks 0.01 USDC for the same execution, then it is released to the validator
 *     address (the "payee") once Pass + anchor exist, and the balance change is checked
 *
 * The receipt is a labelled synthetic fixture (executionId starts with "smoke_"); it is not a real agent run.
 */
import { buildReceipt, computeEvidenceRoot, executionKey, hashEvidenceContent, hashPolicy, hashResult, hashTask, hashValidationResult, verifyReceipt, type EvidenceCommitmentInput, type Receipt, type ValidationResult } from "@verid/core";
import { createWalletClient, defineChain, http, parseUnits, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRelayer } from "../src/relayer";
import { ViemChainReader } from "../src/reader";
import { erc20Abi, escrowAbi } from "../src/abi-settlement";
import { clientFor, deployedFromBroadcast, fail, loadSecrets, parseArgs, presetFor, secretsPath, short } from "./arc-lib";

const { flags, network } = parseArgs(process.argv.slice(2));
const net = presetFor(network);
if (network === "mainnet" && !flags.has("mainnet-i-am-sure")) fail("This spends REAL USDC on Arc Mainnet. Re-run with --mainnet-i-am-sure if you mean it.");

const secrets = loadSecrets(network);
if (!secrets) fail(`no server keys at ${secretsPath(network)}. Run \`pnpm arc:keys --network ${network}\`.`);
const d = deployedFromBroadcast(net.chainId);
if (!d.registry || !d.validation || (flags.has("escrow") && !d.escrow)) fail("deployed addresses not found in the Foundry broadcast. Deploy first (see /docs/deploy-arc).");

const relayer = createRelayer({
  rpcUrl: net.rpcUrl, chainId: net.chainId, networkName: `arc-${network}`, registryAddress: d.registry,
  privateKey: secrets.relayerPrivateKey, minMaxFeePerGas: net.minMaxFeePerGas,
  validationAddress: d.validation, validatorPrivateKey: secrets.validatorPrivateKey, escrowAddress: d.escrow,
  confirmationTimeoutMs: 120_000,
});
const pub = clientFor(net);
const step = (n: number, t: string) => console.log(`\n${n}. ${t}`);
const ok = (t: string) => console.log(`   ✓ ${t}`);

// ---- synthetic, clearly-labelled receipt fixture
const executionId = `smoke_${Date.now().toString(36)}`;
const task = { description: "Arc smoke test (synthetic fixture, not a real agent run)", parameters: {} };
const policy = { id: "smoke-policy", version: 1, rules: {} };
const evidence: EvidenceCommitmentInput[] = [0, 1].map((n) => ({
  executionId, sequenceNumber: n, type: n === 0 ? ("task" as const) : ("result" as const),
  timestamp: new Date().toISOString(), contentHash: hashEvidenceContent({ executionId, n }),
}));
const result = { ok: true };
const validation: ValidationResult = {
  validatorId: "smoke-validator", validatorVersion: "1.0.0", executionId, status: "pass",
  checks: [{ id: "smoke", description: "synthetic pass", ok: true, determinate: true }], evidenceRefs: [0, 1], validatedAt: new Date().toISOString(),
};
const receipt: Receipt = buildReceipt({
  receiptId: `rcpt_${executionId}`, executionId, agent: { id: "smoke-agent", version: "1.0.0" },
  task: { hash: hashTask(task) }, policy: { id: policy.id, hash: hashPolicy(policy) },
  evidence: { root: computeEvidenceRoot(evidence).root, count: evidence.length }, result: { hash: hashResult(result) },
  validation: { status: "pass", validatorId: validation.validatorId, validatorVersion: validation.validatorVersion, resultHash: hashValidationResult(validation) },
});
console.log(`${net.name} smoke test, execution ${executionId}`);

// ---- escrow funding first (so release can happen at the end)
const relayerAccount = privateKeyToAccount(secrets.relayerPrivateKey);
const chain: Chain = defineChain({ id: net.chainId, name: net.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [net.rpcUrl] } } });
const wallet = createWalletClient({ chain, account: relayerAccount, transport: http(net.rpcUrl, { timeout: 30_000 }) });
const feeArgs = async () => {
  const f = await pub.estimateFeesPerGas();
  const max = f.maxFeePerGas && f.maxFeePerGas > net.minMaxFeePerGas ? f.maxFeePerGas : net.minMaxFeePerGas;
  return { maxFeePerGas: max, maxPriorityFeePerGas: f.maxPriorityFeePerGas && f.maxPriorityFeePerGas <= max ? f.maxPriorityFeePerGas : 0n };
};
const AMOUNT = parseUnits("0.01", 6); // ERC-20 interface: 6 decimals
const payee: Address = secrets.validatorAddress;

if (flags.has("escrow")) {
  step(0, "Fund an escrow (relayer is the payer, validator address is the payee): 0.01 USDC");
  const approve = await wallet.writeContract({ address: net.usdcAddress, abi: erc20Abi, functionName: "approve", args: [d.escrow!, AMOUNT], ...(await feeArgs()) });
  await pub.waitForTransactionReceipt({ hash: approve, confirmations: 1, timeout: 120_000 });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  const create = await wallet.writeContract({ address: d.escrow!, abi: escrowAbi, functionName: "create", args: [executionKey(executionId), payee, AMOUNT, deadline], ...(await feeArgs()) });
  await pub.waitForTransactionReceipt({ hash: create, confirmations: 1, timeout: 120_000 });
  ok(`escrow funded (tx ${short(create)})`);
}

step(1, "Validator records Pass on VeridValidation");
if (!relayer.validationRecorder) fail("validation recorder not configured");
const rec = await relayer.validationRecorder.record({ executionId, status: "pass", resultHash: receipt.validation.resultHash, validatorVersion: validation.validatorVersion });
if (rec.status !== "confirmed") fail(`validation record ended ${rec.status}`);
ok(`recorded${rec.txHash ? ` (tx ${short(rec.txHash)})` : ""}`);

step(2, "Relayer anchors the receipt on VeridRegistry");
const anchor = await relayer.anchorer.submit(receipt);
if (anchor.status !== "confirmed") fail(`anchor ended ${anchor.status}${"txHash" in anchor ? ` (tx ${anchor.txHash})` : ""}`);
ok(`anchored in block #${anchor.blockNumber} (tx ${short(anchor.txHash)})`);

step(3, "Verify from the chain alone (no Verid server)");
const anchored: Receipt = { ...receipt, anchor: { network: `arc-${network}`, chainId: net.chainId, registryAddress: d.registry, transactionHash: anchor.txHash, blockNumber: anchor.blockNumber } };
const report = await verifyReceipt(JSON.parse(JSON.stringify(anchored)), {
  bundle: { task, policy, evidence, result, validation },
  chain: new ViemChainReader(pub, d.registry),
});
for (const c of report.checks) console.log(`   ${c.status.padEnd(10)} ${c.label}`);
if (report.outcome !== "verified") fail(`verification outcome was "${report.outcome}"`);
ok(`VERIFIED: every check ran and passed against ${net.name}`);

if (flags.has("escrow")) {
  step(4, "Release the escrow (Pass recorded + anchored)");
  const esc = relayer.escrow!;
  const before = await pub.readContract({ address: net.usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [payee] });
  if (!(await esc.canRelease(executionId))) fail("the contract says the escrow is not releasable even though Pass + anchor exist");
  const out = await esc.release(executionId);
  if (out.status !== "confirmed") fail(`release ended ${out.status}`);
  const after = await pub.readContract({ address: net.usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [payee] });
  if (after - before !== AMOUNT) fail(`payee balance changed by ${after - before}, expected ${AMOUNT}`);
  ok(`released: payee received exactly 0.01 USDC${out.txHash ? ` (tx ${short(out.txHash)})` : ""}`);
}

console.log(`\n✓ SMOKE TEST PASSED on Arc ${network}. Contracts, keys, anchoring, verification${flags.has("escrow") ? " and escrow" : ""} all work.\n`);
