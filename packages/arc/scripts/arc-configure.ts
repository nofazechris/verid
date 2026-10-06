/**
 * Point the local app at Arc: reads the deployed addresses from the Foundry broadcast of your deploy and the
 * server keys from .arc-secrets, and writes a managed block into apps/web/.env.local (git-ignored). It replaces
 * the local dev-chain block, because the two cannot both be active.
 *
 *   pnpm arc:configure [--network testnet|mainnet] [--mainnet-i-am-sure]
 *
 * Nothing secret is printed. For a hosted deployment, put the same variables into your host's secret manager
 * instead of a file.
 */
import { fail, deployedFromBroadcast, loadSecrets, parseArgs, presetFor, secretsPath, short, writeEnvBlock } from "./arc-lib";

const { flags, network } = parseArgs(process.argv.slice(2));
const net = presetFor(network);
if (network === "mainnet" && !flags.has("mainnet-i-am-sure")) {
  fail("This configures the app to spend REAL USDC from the relayer. Re-run with --mainnet-i-am-sure if that is what you want.");
}

const secrets = loadSecrets(network);
if (!secrets) fail(`no server keys at ${secretsPath(network)}. Run \`pnpm arc:keys --network ${network}\` first.`);
const d = deployedFromBroadcast(net.chainId);
const missing = (["registry", "validation", "escrow"] as const).filter((k) => !d[k]);
if (missing.length) {
  fail(`could not find the deployed ${missing.join(", ")} address(es) in contracts/broadcast/Deploy.s.sol/${net.chainId}/run-latest.json.\nDeploy first (see /docs/deploy-arc), or set the addresses by hand.`);
}

writeEnvBlock(`arc-${network}`, [
  `ARC_RPC_URL=${net.rpcUrl}`,
  `ARC_CHAIN_ID=${net.chainId}`,
  `ARC_NETWORK_NAME=arc-${network}`,
  `VERID_REGISTRY_ADDRESS=${d.registry}`,
  `VERID_RELAYER_PRIVATE_KEY=${secrets.relayerPrivateKey}`,
  `VERID_VALIDATION_ADDRESS=${d.validation}`,
  `VERID_VALIDATOR_PRIVATE_KEY=${secrets.validatorPrivateKey}`,
  `VERID_ESCROW_ADDRESS=${d.escrow}`,
]);

console.log(`
Configured apps/web/.env.local for Arc ${network} (chain ${net.chainId}).
  registry   ${d.registry}
  validation ${d.validation}
  escrow     ${d.escrow}
  relayer    ${short(secrets.relayerAddress)}   validator ${short(secrets.validatorAddress)}
The local dev-chain settings were removed. Restart the app (pnpm dev) to load them.
Explorer links stay off until you confirm the explorer's URL scheme (set NEXT_PUBLIC_ARC_EXPLORER_URL then).
`);
