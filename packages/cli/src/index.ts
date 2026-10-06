import { EXIT, runVerify, type Io, type VerifyCommandDeps } from "./verify-command";

export * from "./verify-command";

const HELP = `verid — independent verification of VERID execution receipts

Commands:
  verid receipt verify <receipt.json> [--bundle <file>] [--json]

Run 'verid receipt verify --help' for details.`;

export async function main(argv: string[], io: Io, deps: VerifyCommandDeps = {}): Promise<number> {
  const [group, cmd, ...rest] = argv;
  if (!group || group === "-h" || group === "--help" || group === "help") {
    io.out(HELP);
    return EXIT.VERIFIED;
  }
  if (group === "receipt" && cmd === "verify") return runVerify(rest, io, deps);
  io.err(`error: unknown command '${argv.join(" ")}'\n\n${HELP}`);
  return EXIT.USAGE;
}
