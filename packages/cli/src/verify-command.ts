import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { verifyReceipt, type ChainReader, type VerificationBundle, type VerificationReport } from "@verid/core";
import { createArcReader } from "@verid/arc";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export const EXIT = { VERIFIED: 0, INVALID: 1, INCOMPLETE: 2, USAGE: 64, IO: 66 } as const;

const USAGE = `Usage: verid receipt verify <receipt.json> [options]

Options:
  --bundle <file>   JSON with any of: task, policy, evidence, result, validation.
                    Each supplied item is recomputed and compared to its commitment.
  --rpc <url>       Arc RPC endpoint to verify the anchor directly from the chain
                    (default: $ARC_RPC_URL). Without it, chain checks are NOT_CHECKED.
  --registry <addr> VeridRegistry address (default: $VERID_REGISTRY_ADDRESS).
  --json            Print the structured verification report as JSON.
  -h, --help        Show this help.

Exit codes: 0 verified, 1 invalid, 2 incomplete (some checks not run), 64 usage, 66 unreadable input.
Checks that cannot run are reported NOT_CHECKED / UNAVAILABLE and never count as verified.`;

/** Rendering is intentionally a plain function so it can be tested and reused. */
export function renderReport(report: VerificationReport): string {
  const width = Math.max(...report.checks.map((c) => c.label.length)) + 3;
  const lines = ["VERID RECEIPT VERIFICATION", ""];
  for (const c of report.checks) {
    lines.push(`${c.label.padEnd(width)}${c.status}${c.detail ? `  (${c.detail})` : ""}`);
  }
  lines.push("");
  lines.push(
    report.outcome === "verified"
      ? "VERIFICATION COMPLETE"
      : report.outcome === "invalid"
      ? "VERIFICATION FAILED — receipt is invalid or inconsistent"
      : "VERIFICATION INCOMPLETE — some checks could not be performed",
  );
  return lines.join("\n");
}

async function readJson(path: string, io: Io, what: string): Promise<unknown | typeof FAIL> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    io.err(`error: cannot read ${what} '${path}': ${(e as NodeJS.ErrnoException).code ?? e}`);
    return FAIL;
  }
  try {
    return JSON.parse(text);
  } catch {
    io.err(`error: ${what} '${path}' is not valid JSON`);
    return FAIL;
  }
}
const FAIL = Symbol("fail");

export interface VerifyCommandDeps {
  /** Supplies a ChainReader when network checks are configured. Added by @verid/arc. */
  chain?: ChainReader;
}

export async function runVerify(argv: string[], io: Io, deps: VerifyCommandDeps = {}): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        bundle: { type: "string" },
        rpc: { type: "string" },
        registry: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    io.err(`error: ${(e as Error).message}\n\n${USAGE}`);
    return EXIT.USAGE;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE);
    return EXIT.VERIFIED;
  }
  if (positionals.length !== 1) {
    io.err(`error: expected exactly one receipt file\n\n${USAGE}`);
    return EXIT.USAGE;
  }

  const receipt = await readJson(positionals[0]!, io, "receipt");
  if (receipt === FAIL) return EXIT.IO;

  let bundle: VerificationBundle | undefined;
  if (values.bundle) {
    const b = await readJson(values.bundle, io, "bundle");
    if (b === FAIL) return EXIT.IO;
    if (typeof b !== "object" || b === null || Array.isArray(b)) {
      io.err("error: bundle must be a JSON object");
      return EXIT.USAGE;
    }
    bundle = b as VerificationBundle;
  }

  let chain = deps.chain;
  if (!chain) {
    const rpc = values.rpc ?? process.env.ARC_RPC_URL;
    const registry = values.registry ?? process.env.VERID_REGISTRY_ADDRESS;
    if (rpc || values.registry) {
      if (!rpc || !registry) {
        io.err("error: network verification needs both an RPC URL (--rpc / ARC_RPC_URL) and a registry address (--registry / VERID_REGISTRY_ADDRESS)");
        return EXIT.USAGE;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) {
        io.err("error: --registry must be a 20-byte hex address");
        return EXIT.USAGE;
      }
      chain = createArcReader({ rpcUrl: rpc }, registry as `0x${string}`);
    }
  }

  const report = await verifyReceipt(receipt, { bundle, chain });
  if (values.json) {
    io.out(JSON.stringify(report, null, 2));
  } else {
    io.out(renderReport(report));
    if (!chain && report.checks.some((c) => c.id === "arc_tx" && c.status === "NOT_CHECKED")) {
      io.out("\nnote: network checks were skipped (no Arc RPC configured); the Arc anchor was NOT verified.");
    }
  }
  return report.outcome === "verified" ? EXIT.VERIFIED : report.outcome === "invalid" ? EXIT.INVALID : EXIT.INCOMPLETE;
}
