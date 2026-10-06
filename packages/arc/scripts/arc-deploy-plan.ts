/**
 * Prints the exact deploy commands for your setup. It runs nothing and sends nothing.
 *
 *   pnpm arc:deploy-plan --owner 0xYourOwnerAddress [--network testnet|mainnet] [--account verid-deployer]
 *
 * --owner is the address that will OWN the registry and validation contracts (a multisig or hardware wallet;
 * NOT the hot deployer key). Ownership moves in two steps: that address must call acceptOwnership() afterwards.
 */
import { isAddress } from "viem";
import { fail, loadSecrets, parseArgs, presetFor, secretsPath } from "./arc-lib";

const { values, network } = parseArgs(process.argv.slice(2));
const net = presetFor(network);
const owner = values.owner;
const account = values.account ?? "verid-deployer";
if (!owner || !isAddress(owner)) fail("pass --owner 0x... (the address that will own the contracts)");
const s = loadSecrets(network);
if (!s) fail(`no server keys at ${secretsPath(network)}. Run \`pnpm arc:keys --network ${network}\` first.`);

const common = `forge script script/Deploy.s.sol --rpc-url ${net.rpcUrl} --account ${account} --broadcast --with-gas-price 30gwei`;
console.log(`
DEPLOY PLAN, Arc ${network} (chain ${net.chainId})   (nothing has been sent)

  owner of registry + validation   ${owner}
  anchorer (relayer)               ${s.relayerAddress}
  validator                        ${s.validatorAddress}
  escrow token (USDC)              ${net.usdcAddress}
  deployer keystore account        ${account}   (you will be asked for its password)

Run in PowerShell, from the repository root:

  $env:VERID_OWNER="${owner}"
  $env:VERID_ANCHORER="${s.relayerAddress}"
  $env:VERID_VALIDATOR="${s.validatorAddress}"
  $env:VERID_USDC="${net.usdcAddress}"
  cd contracts
  ${common}
  cd ..

Or in bash / Git Bash:

  export VERID_OWNER=${owner} VERID_ANCHORER=${s.relayerAddress} \
         VERID_VALIDATOR=${s.validatorAddress} VERID_USDC=${net.usdcAddress}
  cd contracts && ${common} && cd ..

Notes
  - --with-gas-price 30gwei keeps the transactions above Arc's 20 gwei floor; cheaper ones are silently dropped.
    If the doctor shows a higher fee, use that instead.
  - Foundry needs to be on your PATH (Windows: it lives in ~/.foundry/bin).
  - AFTER it finishes:  pnpm arc:doctor --network ${network}   then   pnpm arc:configure --network ${network}
    then   pnpm arc:smoke --network ${network} --escrow
${owner.toLowerCase() === "0x" ? "" : `  - ${owner} must call acceptOwnership() on VeridRegistry and VeridValidation (the doctor reminds you).`}
`);
