# VERID

**Make autonomous work verifiable.**

VERID records what an AI agent was asked to do, the policy it ran under, the evidence it
produced, how the result was validated, and packages that into a portable receipt whose
commitments are anchored on Arc and can be verified **independently of the VERID dashboard**.

> An agent should not have to be trusted because it says it finished the task. Its
> execution should leave evidence another system can verify.

Read [docs/architecture.md](docs/architecture.md) first — it states exactly what VERID
proves and what it does not.

## Status

| Area | State |
|---|---|
| `@verid/core` — canonical JSON, commitments, evidence root, state machine, receipt, verifier | done, tested |
| `@verid/validators` — deterministic `ResearchValidator` | done, tested |
| `@verid/arc` — viem chain reader, idempotent anchoring, network config | done, tested against a real local EVM |
| `@verid/cli` — `verid receipt verify` (offline or against the chain) | done, tested |
| `contracts/` — `VeridRegistry`, `VeridValidation`, `VeridEscrow`, deploy script | done, 56 Foundry tests |
| `packages/sdk` (`@verid/sdk`) and `packages/sdk-python` (`verid.py`) — one `verid.run()` call | done, hosted by the app at `/sdk/` |
| `examples/research-agent-service` — a real, deployable research agent (Wikipedia + Hacker News + optional Claude) | done, runs against any Verid server |
| `examples/github-research` — a minimal real agent run (Node + Python) | done |
| `examples/research-agent` — end-to-end test harness (local chain, labelled fixture; not shown on the site) | done |
| `apps/web` — dashboard UI | design ported; **still on mock data**, not yet wired to the backend |
| Database, auth, API, API keys, workspace isolation | not started |
| `VeridEscrow` (USDC settlement), SDK package (`@verid/sdk`), `@verid/react` | not started |
| **Arc Mainnet deployment** | **not done** — requires the owner's funded key (see below) |

Nothing in this repository has been deployed to Arc Mainnet and no on-chain proof here is
from Arc. Tests run against a local `anvil` EVM, which is **not** Arc.

## Documentation

The full documentation is built into the app at `/docs` (run `pnpm dev`, open <http://localhost:3000/docs>):
what Verid is, quickstart, connecting an agent (TypeScript and Python), SDKs versus the API, validators,
settlement and escrow, verification and the CLI, the REST API reference, commitments and hashing, and
self-hosting with the complete configuration reference. `docs/architecture.md` is the normative spec for
hashing and the trust model.

## Requirements

Node >= 20, pnpm 9, [Foundry](https://book.getfoundry.sh/) (for contracts and the local-chain tests).

## Quick start

```bash
pnpm install
pnpm test                       # core, validators, cli, arc, example (anvil tests need Foundry on PATH)
cd contracts && forge build && forge test    # 56 contract tests
```

Run the whole product locally (the local chain is anvil, **not** Arc):

```bash
pnpm dev:chain                  # terminal 1: anvil + registry + validation + dev USDC + escrow; writes apps/web/.env.local
pnpm dev                        # terminal 2: http://localhost:3000 (sign up; the verification link shows on the page in dev)
pnpm dev:fund-escrow <executionId> 25   # fund a local escrow (a real user does this from their wallet in the UI)
```

Then open **Get started** in the dashboard: it walks you through creating an API key, installing the SDK (the app serves it at `/sdk/verid-sdk.tgz`), running the real research agent (`/examples/research-agent/`), and watching it appear, with health monitoring on the Agents page. From an execution you can Anchor on Arc, Link escrow and Settle escrow.
Restarting `dev:chain` resets the local chain; restart `pnpm dev` after it so new addresses load.

Verify a receipt from the command line:

```bash
# offline: schema + commitment checks only; chain checks are reported NOT_CHECKED
node packages/cli/bin/verid.mjs receipt verify receipt.json --bundle bundle.json

# against a chain, reading it directly (no VERID backend involved)
node packages/cli/bin/verid.mjs receipt verify receipt.json --bundle bundle.json \
  --rpc "$ARC_RPC_URL" --registry "$VERID_REGISTRY_ADDRESS"
```

Exit codes: `0` verified, `1` invalid, `2` incomplete (some checks could not run), `64` usage, `66` unreadable input.

## Arc tooling (testnet first)

```bash
pnpm arc:keys                                   # generate relayer + validator keys (addresses shown, keys saved to .arc-secrets/)
pnpm arc:doctor --deployer 0x...                # read-only readiness check (network, fee floor, USDC, balances, wiring)
pnpm arc:deploy-plan --owner 0x...              # prints the exact forge deploy commands; sends nothing
pnpm arc:configure                              # after deploying: write addresses + keys into apps/web/.env.local
pnpm arc:smoke --escrow                         # real testnet transactions: record, anchor, verify from chain, escrow release
```

Full walkthrough: `/docs/deploy-arc` in the app.

## Deploying to Arc Mainnet (you run this — it needs your key and real funds)

1. Re-verify chain parameters in the official docs: <https://docs.arc.io> (chain ID, RPC, explorer, USDC).
2. `cd contracts && forge test` — everything must pass.
3. Import your deployer key into an **encrypted keystore** (never into `.env`):
   `cast wallet import verid-deployer --interactive`
4. Set `VERID_OWNER` (a multisig/hardware wallet — not the hot deployer) and `VERID_ANCHORER`
   (the backend relayer address) in your shell.
5. `forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --account verid-deployer --broadcast`
6. The owner calls `acceptOwnership()` on both contracts. Read the deployed state back, record the
   addresses in `.env`, then perform a real test anchor and verify it with the CLI.

Never commit keys. `.env` is git-ignored; see `.env.example`.

## Repository layout

```
apps/web/               Next.js dashboard (design port; mock data for now)
packages/core/          commitments, evidence root, receipt, state machine, verifier
packages/validators/    ResearchValidator
packages/arc/           viem chain reader + idempotent anchoring
packages/cli/           `verid` command
contracts/              Foundry project (src, test, script)
packages/sdk/              @verid/sdk (TypeScript, zero dependencies), served by the app
packages/sdk-python/       verid.py (one file, standard library only), served by the app
examples/research-agent-service/  deployable research agent (Dockerfile, render.yaml)
examples/github-research/  minimal runnable real-agent example (Node + Python), served by the app
examples/research-agent/  end-to-end test harness (uses a labelled fixture on a local chain)
docs/                   architecture & trust model
```

## License

MIT
