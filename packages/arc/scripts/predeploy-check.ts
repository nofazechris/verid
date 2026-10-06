/**
 * Production readiness check for the Verid web app. Read-only: sends NO transactions, writes nothing.
 *
 *   pnpm predeploy                                  # checks the current environment (process.env)
 *   pnpm predeploy --env apps/web/.env.local        # checks a file of KEY=VALUE lines (paths are from the repo root; values never printed)
 *
 * Run it with the SAME values your host will have. It verifies the things that otherwise fail only after you go live:
 * secrets and URLs, the database (reachable and fully migrated), email, Google sign-in, and the Arc wiring (RPC is
 * the chain you configured, contracts exist, the server keys are allowed to do their jobs and can pay gas).
 * Secret values are never printed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, defineChain, formatEther, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { registryAbi } from "../src/abi";
import { escrowAbi, validationAbi } from "../src/abi-settlement";
import { ROOT, parseArgs } from "./arc-lib";

const { values } = parseArgs(process.argv.slice(2));
const env: Record<string, string | undefined> = { ...process.env };
if (values.env) {
  const p = resolve(ROOT, values.env);
  if (!existsSync(p)) {
    console.error(`env file not found: ${p}`);
    process.exit(1);
  }
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

let problems = 0;
let notes = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => (problems++, console.log(`  ✕ ${m}`));
const note = (m: string) => (notes++, console.log(`  ! ${m}`));
const h = (t: string) => console.log(`\n${t}`);
const has = (k: string) => !!env[k] && env[k] !== "";

// ------------------------------------------------------------------------------------------ app
h("1. App URL and secrets");
const url = env.NEXTAUTH_URL;
if (!url) bad("NEXTAUTH_URL is not set");
else if (!/^https:\/\//.test(url)) bad(`NEXTAUTH_URL must be https in production (is ${url.startsWith("http://localhost") ? "localhost" : "not https"})`);
else ok(`NEXTAUTH_URL ${url}`);
if (has("APP_URL") && url && new URL(env.APP_URL!).origin !== new URL(url).origin) bad("APP_URL and NEXTAUTH_URL are different origins; links in emails and the CSRF origin check will disagree");
else if (!has("APP_URL")) note("APP_URL not set; NEXTAUTH_URL is used (fine)");
else ok("APP_URL matches NEXTAUTH_URL");
const sec = env.NEXTAUTH_SECRET ?? "";
if (sec.length < 32) bad(`NEXTAUTH_SECRET is ${sec ? "too short" : "not set"} (use: openssl rand -base64 32)`);
else ok("NEXTAUTH_SECRET is set and long enough");
if (env.VERID_REQUIRE_VERIFIED_EMAIL === "false") note("VERID_REQUIRE_VERIFIED_EMAIL=false: unverified users can use the app");

// ------------------------------------------------------------------------------------- database
h("2. Database");
if (!has("DATABASE_URL")) bad("DATABASE_URL is not set (production refuses to start without it)");
else {
  try {
    // The database library lives in the server package, so the check runs there (it prints one JSON line).
    const out = execFileSync("pnpm", ["--filter", "@verid/server", "exec", "tsx", "scripts/db-status.ts"], {
      cwd: ROOT, env: { ...process.env, ...env } as NodeJS.ProcessEnv, shell: true, stdio: ["ignore", "pipe", "ignore"], timeout: 90_000,
    }).toString().trim().split(String.fromCharCode(10)).pop()!.trim();
    const r = JSON.parse(out) as { ok: boolean; error?: string; applied?: number; journal?: number };
    if (!r.ok) bad(`could not use the database: ${r.error}`);
    else {
      ok("connected");
      r.applied === r.journal ? ok(`all ${r.journal} migrations are applied`) : bad(`${r.applied} of ${r.journal} migrations applied. Run: DATABASE_URL=... pnpm --filter @verid/server db:migrate`);
    }
  } catch (e) {
    bad(`could not check the database: ${(e as Error).message.split("\n")[0]}`);
  }
}

// ------------------------------------------------------------------------------ email and google
h("3. Email and Google sign-in");
if (!has("RESEND_API_KEY")) bad("RESEND_API_KEY is not set: no one can verify their email (production refuses to start)");
else {
  ok("RESEND_API_KEY is set");
  if (!has("RESEND_FROM")) bad("RESEND_FROM is not set");
  else if (/resend\.dev/i.test(env.RESEND_FROM!)) note("RESEND_FROM uses Resend's test sender: it only delivers to YOUR OWN address. Verify a domain in Resend before real users sign up.");
  else ok(`RESEND_FROM ${env.RESEND_FROM}`);
}
if (has("GOOGLE_CLIENT_ID") !== has("GOOGLE_CLIENT_SECRET")) bad("set BOTH GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither");
else if (has("GOOGLE_CLIENT_ID")) {
  ok("Google sign-in configured");
  if (url) note(`In Google Cloud, the OAuth client must allow the redirect URI ${url}/api/auth/callback/google`);
} else note("Google sign-in is off (email and password only)");

// -------------------------------------------------------------------------------------------- arc
h("4. Arc (anchoring, validation records, escrow)");
const arcKeys = ["ARC_RPC_URL", "ARC_CHAIN_ID", "VERID_REGISTRY_ADDRESS", "VERID_RELAYER_PRIVATE_KEY"] as const;
if (!arcKeys.some(has)) note("No chain configured: runs are validated and get receipts but are NOT anchored, and escrow is unavailable.");
else if (!arcKeys.every(has)) bad(`incomplete chain configuration, missing: ${arcKeys.filter((k) => !has(k)).join(", ")}`);
else {
  try {
    const chainId = Number(env.ARC_CHAIN_ID);
    const rpc = env.ARC_RPC_URL!;
    const chain = defineChain({ id: chainId, name: "arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
    const client = createPublicClient({ chain, transport: http(rpc, { timeout: 20_000, retryCount: 2 }) });
    const actual = await client.getChainId();
    if (actual !== chainId) bad(`RPC reports chain ${actual} but ARC_CHAIN_ID is ${chainId}: the server will refuse to send anything`);
    else ok(`RPC is chain ${actual}`);
    if (actual === 5042) note("This is Arc MAINNET: real USDC. Confirm the owner is a multisig, the parameters were re-verified in Arc's docs, and the explorer link scheme was checked on a real mainnet transaction.");

    const code = async (label: string, a?: string) => {
      if (!a || !isAddress(a)) return bad(`${label} address is missing or invalid`), false;
      const c = await client.getCode({ address: a as Address });
      if (!c || c === "0x") return bad(`${label} ${a}: no contract at this address on this chain`), false;
      ok(`${label} ${a}`);
      return true;
    };
    const reg = await code("VeridRegistry  ", env.VERID_REGISTRY_ADDRESS);
    const relayer = privateKeyToAddress(env.VERID_RELAYER_PRIVATE_KEY as Hex);
    if (reg) {
      const allowed = await client.readContract({ address: env.VERID_REGISTRY_ADDRESS as Address, abi: registryAbi, functionName: "isAnchorer", args: [relayer] });
      allowed ? ok("the relayer key is an allow-listed anchorer") : bad(`the relayer address ${relayer} is NOT an anchorer: the owner must call setAnchorer`);
    }
    const bal = async (label: string, a: Address) => {
      const b = await client.getBalance({ address: a });
      b > 10_000_000_000_000_000n ? ok(`${label} holds ${formatEther(b)} USDC for gas`) : note(`${label} holds only ${formatEther(b)} USDC: top it up or anchoring/settlement will stop`);
    };
    await bal("relayer  ", relayer);

    const wantsEscrow = has("VERID_ESCROW_ADDRESS") || has("VERID_VALIDATION_ADDRESS") || has("VERID_VALIDATOR_PRIVATE_KEY");
    if (!wantsEscrow) note("Escrow is not configured (no validation contract, validator key or escrow address)");
    else if (!(has("VERID_ESCROW_ADDRESS") && has("VERID_VALIDATION_ADDRESS") && has("VERID_VALIDATOR_PRIVATE_KEY"))) {
      bad("incomplete escrow configuration: set VERID_VALIDATION_ADDRESS, VERID_VALIDATOR_PRIVATE_KEY and VERID_ESCROW_ADDRESS together");
    } else {
      const val = await code("VeridValidation", env.VERID_VALIDATION_ADDRESS);
      const esc = await code("VeridEscrow    ", env.VERID_ESCROW_ADDRESS);
      const validator = privateKeyToAddress(env.VERID_VALIDATOR_PRIVATE_KEY as Hex);
      if (validator.toLowerCase() === relayer.toLowerCase()) note("The validator key equals the relayer key. Use separate keys so the roles can be revoked independently.");
      if (val) {
        const id = await client.readContract({ address: env.VERID_VALIDATION_ADDRESS as Address, abi: validationAbi, functionName: "validatorIdOf", args: [validator] });
        /^0x0+$/.test(id) ? bad(`the validator address ${validator} is NOT registered on VeridValidation`) : ok("the validator key is a registered validator");
        await bal("validator", validator);
      }
      if (esc && val && reg) {
        const [v, r] = await Promise.all(["validation", "registry"].map((fn) => client.readContract({ address: env.VERID_ESCROW_ADDRESS as Address, abi: escrowAbi, functionName: fn as "validation" })));
        v.toLowerCase() === env.VERID_VALIDATION_ADDRESS!.toLowerCase() && r.toLowerCase() === env.VERID_REGISTRY_ADDRESS!.toLowerCase() ? ok("the escrow reads this registry and validation contract") : bad("the escrow points at different registry/validation contracts than the ones configured");
      }
    }
  } catch (e) {
    bad(`Arc check failed: ${(e as Error).message.split("\n")[0]}`);
  }
}
if (has("NEXT_PUBLIC_ARC_EXPLORER_URL")) ok(`explorer links on: ${env.NEXT_PUBLIC_ARC_EXPLORER_URL}`);
else note("NEXT_PUBLIC_ARC_EXPLORER_URL is not set: no 'open in explorer' links (testnet: https://explorer.testnet.arc.io)");

console.log(`\n${problems === 0 ? "✓ READY TO DEPLOY" : `✕ ${problems} problem(s) to fix before deploying`}${notes ? `  (${notes} note${notes > 1 ? "s" : ""})` : ""}\n`);
// exitCode, not process.exit(): on Windows a forced exit while HTTP handles close can crash libuv.
process.exitCode = problems === 0 ? 0 : 1;
