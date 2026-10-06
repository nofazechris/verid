/**
 * Generate the two SERVER keys Verid needs on Arc, and show only their addresses:
 *   relayer   - anchors receipts on VeridRegistry (allow-listed as an anchorer)
 *   validator - writes validation records on VeridValidation (registered as a validator)
 * They are separate on purpose so each role can be revoked independently.
 *
 *   pnpm arc:keys [--network testnet|mainnet]
 *
 * Keys are saved to .arc-secrets/<network>.json (git-ignored, owner-only). They are NEVER printed. This script
 * does not create the DEPLOYER key: import that yourself into an encrypted Foundry keystore.
 * Re-running refuses to overwrite existing keys (that would orphan funds on the old addresses).
 */
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { fail, loadSecrets, parseArgs, presetFor, saveSecrets, secretsPath } from "./arc-lib";

const { network } = parseArgs(process.argv.slice(2));
const net = presetFor(network);

if (loadSecrets(network)) {
  fail(`${secretsPath(network)} already exists. Refusing to overwrite keys (any funds on the old addresses would be stranded). Delete the file yourself if you really want new keys.`);
}

const relayerPrivateKey = generatePrivateKey();
const validatorPrivateKey = generatePrivateKey();
saveSecrets({
  network,
  chainId: net.chainId,
  relayerAddress: privateKeyToAddress(relayerPrivateKey),
  relayerPrivateKey,
  validatorAddress: privateKeyToAddress(validatorPrivateKey),
  validatorPrivateKey,
  createdAt: new Date().toISOString(),
});

const s = loadSecrets(network)!;
console.log(`
Generated server keys for Arc ${network} (chain ${net.chainId}). Private keys were saved to
${secretsPath(network)} and are not shown.

  RELAYER   (anchors receipts)          ${s.relayerAddress}
  VALIDATOR (records validation)        ${s.validatorAddress}

NEXT
  1. Fund BOTH addresses with a little USDC for gas (Arc pays gas in USDC).${network === "testnet" ? "\n     Testnet faucet: https://faucet.circle.com" : ""}
  2. Import YOUR deployer key into an encrypted Foundry keystore (you type the key; it is never shown to Verid):
       cast wallet import verid-deployer --interactive
     and fund that address too.
  3. pnpm arc:doctor --network ${network} --deployer <your deployer address>
`);
