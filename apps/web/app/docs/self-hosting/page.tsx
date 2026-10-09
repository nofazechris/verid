import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, OL, P, Table, UL } from "@/components/docs";

export default function SelfHosting() {
  return (
    <>
      <H1 kicker="REFERENCE">Self-hosting &amp; configuration</H1>
      <P>
        Verid is open source and you run it yourself: one Next.js app (dashboard and API), a Postgres database, an optional Arc connection for anchoring and escrow, and an optional email provider. This page covers running it locally, every configuration variable, and a checklist for going live.
      </P>

      <H2>Run it locally in two terminals</H2>
      <CodeBlock>{`# one time
pnpm install
cd contracts && forge build && cd ..        # needs Foundry (https://book.getfoundry.sh)

# terminal 1: a local test chain (anvil) with all contracts deployed. This is NOT Arc.
pnpm dev:chain

# terminal 2: the app, at http://localhost:3000
pnpm dev`}</CodeBlock>
      <UL>
        <li><Code>pnpm dev:chain</Code> deploys <Code>VeridRegistry</Code>, <Code>VeridValidation</Code>, a free dev-only USDC and <Code>VeridEscrow</Code>, creates throwaway relayer and validator keys, and writes the connection settings into <Code>apps/web/.env.local</Code> (git-ignored). Restart <Code>pnpm dev</Code> after it so they load.</li>
        <li>Restarting <Code>dev:chain</Code> resets the local chain. Receipts anchored on a previous run will no longer verify.</li>
        <li>Without <Code>dev:chain</Code> the app still works: anchoring and settlement report “unavailable”, and verification of a receipt’s chain checks is reported NOT_CHECKED or UNAVAILABLE.</li>
        <li>With no <Code>DATABASE_URL</Code>, development uses an embedded Postgres stored under <Code>apps/web/.data</Code>. With no email provider, verification and reset emails appear on the page (dev only).</li>
        <li><Code>pnpm dev:fund-escrow &lt;executionId&gt; 25</Code> funds a local escrow from a pre-funded test account, standing in for a wallet.</li>
      </UL>

      <H2>Configuration reference</H2>
      <H3>Application</H3>
      <Table
        head={["VARIABLE", "REQUIRED", "PURPOSE"]}
        cols="minmax(220px,1fr) minmax(90px,0.5fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">NEXTAUTH_SECRET</Code>, "Production", <>Signs and encrypts session cookies. Generate with <Code key="g">openssl rand -base64 32</Code>. The app refuses to start in production without it.</>],
          [<Code key="2">NEXTAUTH_URL</Code>, "Production", "Public base URL of the app, for example https://app.example.com."],
          [<Code key="3">APP_URL</Code>, "Optional", "Used for links in emails and the CSRF origin allow-list. Defaults to NEXTAUTH_URL, then http://localhost:3000."],
          [<Code key="4">EXTRA_ALLOWED_ORIGINS</Code>, "Optional", "Comma-separated extra browser origins allowed to make cookie-authenticated writes."],
          [<Code key="5">VERID_REQUIRE_VERIFIED_EMAIL</Code>, "Optional", <>Set to <Code key="f">false</Code> to let unverified users in. Default is to require verification.</>],
        ]}
      />
      <H3>Database</H3>
      <Table
        head={["VARIABLE", "REQUIRED", "PURPOSE"]}
        cols="minmax(220px,1fr) minmax(90px,0.5fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">DATABASE_URL</Code>, "Production", "Postgres connection string (Neon works). Required in production."],
          [<Code key="2">VERID_AUTO_MIGRATE</Code>, "Optional", <>Set to <Code key="t">true</Code> to apply migrations at startup. Otherwise run <Code key="m">pnpm --filter @verid/server db:migrate</Code> as a deploy step.</>],
          [<Code key="3">VERID_MIGRATIONS_DIR</Code>, "Optional", "Override the migrations folder if the app is deployed away from the repo layout."],
          [<Code key="4">VERID_DEV_DB_DIR</Code>, "Optional", "Development only: where the embedded database is stored."],
        ]}
      />
      <H3>Email</H3>
      <Table
        head={["VARIABLE", "REQUIRED", "PURPOSE"]}
        cols="minmax(220px,1fr) minmax(90px,0.5fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">RESEND_API_KEY</Code>, "Production", "Resend API key for verification and password-reset emails."],
          [<Code key="2">RESEND_FROM</Code>, "With the key", <>Sender, for example <Code key="x">Verid &lt;no-reply@yourdomain.com&gt;</Code>. The domain must be verified in Resend.</>],
        ]}
      />
      <H3>Google sign-in (optional)</H3>
      <Table
        head={["VARIABLE", "REQUIRED", "PURPOSE"]}
        cols="minmax(220px,1fr) minmax(90px,0.5fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">GOOGLE_CLIENT_ID</Code>, "Optional", "OAuth client ID from Google Cloud Console. Both values must be set or the Google button is not offered."],
          [<Code key="2">GOOGLE_CLIENT_SECRET</Code>, "Optional", <>OAuth client secret. In Google Cloud, add the authorized redirect URI <Code key="u">{`<NEXTAUTH_URL>/api/auth/callback/google`}</Code>.</>],
        ]}
      />
      <H3>Chain (Arc)</H3>
      <Table
        head={["VARIABLE", "REQUIRED", "PURPOSE"]}
        cols="minmax(250px,1fr) minmax(110px,0.55fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">ARC_RPC_URL</Code>, "For chain features", "JSON-RPC endpoint. There are no silent defaults: a missing value means chain features are off, never a guess."],
          [<Code key="2">ARC_CHAIN_ID</Code>, "For chain features", "Numeric chain ID. The server checks it against the RPC before every transaction and refuses on a mismatch."],
          [<Code key="3">ARC_NETWORK_NAME</Code>, "Optional", "Label stored on anchors, for example arc-mainnet."],
          [<Code key="4">VERID_REGISTRY_ADDRESS</Code>, "For chain features", "Deployed VeridRegistry. With only these three set, the app can verify receipts against the chain but cannot anchor."],
          [<Code key="5">VERID_RELAYER_PRIVATE_KEY</Code>, "To anchor", "Secret. A key allow-listed as an anchorer on the registry. Needs gas (on Arc, USDC)."],
          [<Code key="6">VERID_VALIDATION_ADDRESS</Code>, "For escrow", "Deployed VeridValidation."],
          [<Code key="7">VERID_VALIDATOR_PRIVATE_KEY</Code>, "For escrow", "Secret. A key registered as a validator on VeridValidation. Use a different key from the relayer so the roles can be revoked independently."],
          [<Code key="8">VERID_ESCROW_ADDRESS</Code>, "For escrow", "Deployed VeridEscrow."],
          [<Code key="8b">VERID_CONFIRMATION_TIMEOUT_MS</Code>, "Optional", "How long one chain transaction may wait for confirmation before the API answers pending. Default 20000. Keep it under your host’s request time limit (anchoring may wait for two transactions)."],
          [<Code key="9b">NEXT_PUBLIC_CONTACT_EMAIL</Code>, "Recommended", "Public contact address shown on the Terms and Privacy pages. Compiled into the page code at build time."],
          [<Code key="9">NEXT_PUBLIC_ARC_EXPLORER_URL</Code>, "Optional", <>Base URL used to show “open in explorer” links (<Code key="t">/tx/&lt;hash&gt;</Code> is assumed). Verified on testnet: https://explorer.testnet.arc.io. For mainnet, confirm the scheme on a real transaction first.</>],
          [<Code key="10">NEXT_PUBLIC_FEATURED_PROOF_ID</Code>, "Optional", "The ID of a real receipt you choose to feature on the landing page as “Explore a proof”. Leave unset to show “Verify a receipt” instead."],
        ]}
      />
      <Callout title="SECRETS">
        Private keys are read only on the server, are never logged and never returned by the API. Never commit them, never put them in <Code>NEXT_PUBLIC_*</Code> variables, and prefer your host’s secret manager. For deployment, use an encrypted Foundry keystore (<Code>cast wallet import</Code>) rather than a raw key in a file.
      </Callout>

      <H2>Deploying the contracts</H2>
      <P>
        You run this yourself, with your own funded key. Nothing in this repository deploys to a real network on your behalf. The guided path, with scripts that check each step, is <A href="/docs/deploy-arc" css="color:#4ADE80">Deploy to Arc</A>; the summary below is the manual version.
      </P>
      <OL>
        <li>Re-verify the network parameters in the official docs (<a href="https://docs.arc.io" style={{ color: "#4ADE80" }}>docs.arc.io</a>): chain ID, RPC, explorer and the USDC address. Do not rely on any value copied from elsewhere. Arc enforces a minimum base fee; the relayer clamps fees up to it because under-priced transactions are silently dropped.</li>
        <li>Import your deployer key into an encrypted keystore: <Code>cast wallet import verid-deployer --interactive</Code>.</li>
        <li>Choose the owner address (a multisig or hardware wallet, not the hot deployer key), the anchorer (the relayer’s address) and, for escrow, a validator address and the USDC token address.</li>
        <li>Run the script. It never reads a key itself; the signer is the keystore you name.</li>
      </OL>
      <CodeBlock>{`export VERID_OWNER=0x...        # multisig that will own registry + validation
export VERID_ANCHORER=0x...     # relayer address allowed to anchor
export VERID_VALIDATOR=0x...    # optional: address allowed to write validation records
export VERID_USDC=0x...         # optional: set to also deploy VeridEscrow

cd contracts
forge script script/Deploy.s.sol --rpc-url "$ARC_RPC_URL" --account verid-deployer --broadcast`}</CodeBlock>
      <UL>
        <li>Ownership moves in two steps: the new owner must call <Code>acceptOwnership()</Code> on the registry and the validation contract.</li>
        <li>The script prints the addresses. Put them in the variables above.</li>
        <li><Code>VeridEscrow</Code> has no owner. Choose the token carefully, because it cannot be changed.</li>
      </UL>

      <H2>Go-live checklist</H2>
      <OL>
        <li>All tests green: <Code>pnpm -r typecheck</Code>, <Code>pnpm -r test</Code>, <Code>forge test</Code>, <Code>pnpm --filter @verid/web build</Code>.</li>
        <li>Postgres provisioned; <Code>DATABASE_URL</Code> set; migrations applied.</li>
        <li><Code>NEXTAUTH_SECRET</Code>, <Code>NEXTAUTH_URL</Code>, <Code>APP_URL</Code> set; the app is served over HTTPS.</li>
        <li>Resend configured and a test signup email received. Google credentials set if you want Google sign-in.</li>
        <li>Contracts deployed, ownership accepted by the multisig, relayer and validator funded with gas and allow-listed.</li>
        <li>Chain variables set. Anchor one real receipt, then verify it with the CLI from a separate machine using your own RPC.</li>
        <li>Explorer link scheme confirmed on a real transaction before setting <Code>NEXT_PUBLIC_ARC_EXPLORER_URL</Code> (verified for testnet).</li>
        <li>Rate limits: the built-in limiter is per server instance (in memory). Behind multiple instances or a CDN, add a shared limiter or an edge rule.</li>
      </OL>

      <P>
        The architecture and exact hashing rules are in <A href="/docs/commitments" css="color:#4ADE80">Commitments &amp; hashing</A>; what each party must be trusted for is in the <A href="/docs/trust-model" css="color:#4ADE80">trust model</A>.
      </P>
    </>
  );
}
