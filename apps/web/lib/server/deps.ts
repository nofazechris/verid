import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRelayer } from "@verid/arc";
import {
  ConsoleMailer,
  MemoryRateLimiter,
  ResendMailer,
  createPgDb,
  createPgliteDb,
  type DbHandle,
  type Deps,
  type Mailer,
} from "@verid/server";

const isProd = process.env.NODE_ENV === "production";
const GWEI = 1_000_000_000n;

/** Fail loudly in production instead of silently using a development default. */
function requireInProd(name: string, value: string | undefined, devHint: string): string | undefined {
  if (isProd && !value) throw new Error(`${name} is required in production (${devHint})`);
  return value;
}

export function networkNameFor(chainId: number): string {
  // Names for the two networks documented at https://docs.arc.io/arc/references/connect-to-arc
  return chainId === 5042 ? "arc-mainnet" : chainId === 5042002 ? "arc-testnet" : `chain-${chainId}`;
}

async function build(): Promise<{ deps: Deps; db: DbHandle; devMailer?: ConsoleMailer }> {
  const migrationsFolder = process.env.VERID_MIGRATIONS_DIR ?? path.resolve(process.cwd(), "../../packages/server/migrations");

  // ---- database -------------------------------------------------------------
  const url = process.env.DATABASE_URL;
  let db: DbHandle;
  if (url) {
    db = await createPgDb(url, { migrate: process.env.VERID_AUTO_MIGRATE === "true", migrationsFolder });
  } else {
    requireInProd("DATABASE_URL", undefined, "a Postgres connection string, e.g. from Neon");
    // Dev only: embedded Postgres persisted under .data/ (git-ignored).
    const dataDir = process.env.VERID_DEV_DB_DIR ?? path.join(process.cwd(), ".data", "pglite");
    await mkdir(path.dirname(dataDir), { recursive: true });
    db = await createPgliteDb(dataDir, { migrationsFolder });
  }

  // ---- email ----------------------------------------------------------------
  let mailer: Mailer;
  let devMailer: ConsoleMailer | undefined;
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = requireInProd("RESEND_FROM", process.env.RESEND_FROM, 'e.g. "Verid <no-reply@yourdomain>"') ?? process.env.RESEND_FROM;
    if (!from) throw new Error("RESEND_FROM is required when RESEND_API_KEY is set (an address on a domain verified in Resend)");
    mailer = new ResendMailer({ apiKey: resendKey, from });
  } else {
    requireInProd("RESEND_API_KEY", undefined, "needed for verification and password-reset emails");
    devMailer = new ConsoleMailer();
    mailer = devMailer;
  }

  // ---- URLs / CSRF origin allowlist -------------------------------------------
  const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const allowedOrigins = [new URL(appUrl).origin, ...(process.env.EXTRA_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];

  const deps: Deps = {
    db: db.db,
    now: () => new Date(),
    limiter: new MemoryRateLimiter(),
    allowedOrigins,
    mailer,
    appUrl,
    requireVerifiedEmail: process.env.VERID_REQUIRE_VERIFIED_EMAIL !== "false",
    devOutbox: devMailer ? () => devMailer!.outbox : undefined,
  };

  // ---- chain (optional; absent => anchoring reports "unavailable") --------------
  const rpcUrl = process.env.ARC_RPC_URL;
  const chainId = Number(process.env.ARC_CHAIN_ID);
  const registry = process.env.VERID_REGISTRY_ADDRESS;
  const privateKey = process.env.VERID_RELAYER_PRIVATE_KEY;
  if (rpcUrl && Number.isInteger(chainId) && chainId > 0 && registry) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) throw new Error("VERID_REGISTRY_ADDRESS must be a 20-byte hex address");
    if (privateKey) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("VERID_RELAYER_PRIVATE_KEY must be a 32-byte hex string");
      const validationAddress = process.env.VERID_VALIDATION_ADDRESS;
      const validatorKey = process.env.VERID_VALIDATOR_PRIVATE_KEY;
      const escrowAddress = process.env.VERID_ESCROW_ADDRESS;
      for (const [name, v] of [["VERID_VALIDATION_ADDRESS", validationAddress], ["VERID_ESCROW_ADDRESS", escrowAddress]] as const) {
        if (v && !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${name} must be a 20-byte hex address`);
      }
      if (validatorKey && !/^0x[0-9a-fA-F]{64}$/.test(validatorKey)) throw new Error("VERID_VALIDATOR_PRIVATE_KEY must be a 32-byte hex string");
      if (validatorKey && !validationAddress) throw new Error("VERID_VALIDATOR_PRIVATE_KEY requires VERID_VALIDATION_ADDRESS");
      // How long one transaction may wait for confirmation before the API answers "pending" (the caller re-checks).
      // Kept well under typical serverless limits; each anchor/settle may wait for two transactions in a row.
      const confirmationTimeoutMs = Number(process.env.VERID_CONFIRMATION_TIMEOUT_MS ?? 20_000);
      if (!Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs < 1_000) throw new Error("VERID_CONFIRMATION_TIMEOUT_MS must be a number of milliseconds, at least 1000");
      const relayer = createRelayer({
        confirmationTimeoutMs,
        rpcUrl, chainId, networkName: process.env.ARC_NETWORK_NAME ?? networkNameFor(chainId),
        registryAddress: registry as `0x${string}`, privateKey: privateKey as `0x${string}`, minMaxFeePerGas: 20n * GWEI,
        validationAddress: validationAddress as `0x${string}` | undefined,
        validatorPrivateKey: validatorKey as `0x${string}` | undefined,
        escrowAddress: escrowAddress as `0x${string}` | undefined,
      });
      deps.validationRecorder = relayer.validationRecorder;
      deps.escrow = relayer.escrow;
      deps.anchorer = relayer.anchorer;
      deps.chain = relayer.reader;
      deps.chainStatus = relayer.status;
    } else {
      // Read-only: public receipt verification works, anchoring stays unavailable.
      const { createArcReader } = await import("@verid/arc");
      const { createPublicClient, http } = await import("viem");
      deps.chain = createArcReader({ rpcUrl }, registry as `0x${string}`);
      const client = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000 }) });
      deps.chainStatus = async () => ({ chainId: await client.getChainId(), blockNumber: Number(await client.getBlockNumber()) });
    }
  }
  return { deps, db, devMailer };
}

// Cache across hot reloads in dev and across requests in a warm server instance.
const g = globalThis as unknown as { __verid?: Promise<{ deps: Deps }> };

export function getDeps(): Promise<Deps> {
  if (!g.__verid) {
    const p = build().then(({ deps }) => ({ deps }));
    // Never cache a failed startup: a later request must be able to retry (e.g. after fixing config).
    p.catch(() => {
      if (g.__verid === p) g.__verid = undefined;
    });
    g.__verid = p;
  }
  return g.__verid.then((x) => x.deps);
}
