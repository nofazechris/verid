import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, OL, P, Table, UL } from "@/components/docs";

export default function DeployApp() {
  return (
    <>
      <H1 kicker="GUIDES">Host Verid (go live)</H1>
      <P>
        This is the checklist for putting the Verid app on the internet so other people can sign up, create keys and connect agents. The app is one Next.js project (dashboard, API and docs together) plus a Postgres database and, optionally, the Arc contracts. Do the <A href="/docs/deploy-arc" css="color:#4ADE80">Arc deploy</A> first if you want anchoring and escrow.
      </P>
      <Callout title="WHAT HAS AND HAS NOT BEEN TESTED">
        The app has been run end to end locally against a real Neon database, real Resend email, Google sign-in and Arc testnet. It has <b>not</b> been deployed to a hosting provider by the Verid project, so the host-specific steps below are standard Next.js practice, not a verified recipe. Test on a staging URL first.
      </Callout>

      <H2>1. What you need</H2>
      <Table
        head={["THING", "WHY", "STATUS HERE"]}
        cols="minmax(160px,0.8fr) minmax(0,1.6fr) minmax(0,1fr)"
        rows={[
          ["Postgres", "All data. Neon works; any Postgres 14+ does.", "Neon in use"],
          ["A host for Next.js 14", "Vercel, Render, Railway, Fly, or any machine with Node 20+.", "Your choice"],
          ["A domain (recommended)", "A stable URL for links, Google sign-in and email sending.", "Your choice"],
          ["Resend + a verified domain", "Verification and password-reset email to real users (the test sender only reaches your own address).", "Test sender only"],
          ["Google OAuth credentials", "“Continue with Google”. Optional.", "Working locally"],
          ["Arc contracts + two server keys", "Anchoring, validation records and escrow. Optional but it is the point.", "Deployed on testnet"],
        ]}
      />

      <H2>2. Environment variables</H2>
      <P>Set these in your host’s secret manager (never in the repository). The full reference with every option is in <A href="/docs/self-hosting" css="color:#4ADE80">Self-hosting &amp; configuration</A>.</P>
      <CodeBlock title="REQUIRED">{`NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://your-domain.example         # the public URL, https
APP_URL=https://your-domain.example
DATABASE_URL=postgresql://...                    # Neon connection string`}</CodeBlock>
      <CodeBlock title="EMAIL AND GOOGLE">{`RESEND_API_KEY=re_...
RESEND_FROM="Verid <no-reply@your-domain.example>"   # a domain you verified in Resend
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...                         # add https://your-domain.example/api/auth/callback/google in Google Cloud`}</CodeBlock>
      <CodeBlock title="ARC (ANCHORING, VALIDATION RECORDS, ESCROW)">{`ARC_RPC_URL=https://rpc.testnet.arc.io           # or the mainnet RPC, after re-verifying it in Arc's docs
ARC_CHAIN_ID=5042002
ARC_NETWORK_NAME=arc-testnet
VERID_REGISTRY_ADDRESS=0x...
VERID_VALIDATION_ADDRESS=0x...
VERID_ESCROW_ADDRESS=0x...
VERID_RELAYER_PRIVATE_KEY=0x...                  # secret
VERID_VALIDATOR_PRIVATE_KEY=0x...                # secret, a different key
VERID_CONFIRMATION_TIMEOUT_MS=20000              # how long one chain transaction may wait before answering "pending"
NEXT_PUBLIC_ARC_EXPLORER_URL=https://explorer.testnet.arc.io`}</CodeBlock>

      <H2>3. Steps</H2>
      <OL>
        <li><b>Migrate the database once, before the first deploy and after any release that adds migrations.</b> The app does not migrate by itself unless you set <Code>VERID_AUTO_MIGRATE=true</Code>.
          <CodeBlock>{`DATABASE_URL=postgresql://... pnpm --filter @verid/server db:migrate`}</CodeBlock>
        </li>
        <li><b>Build and start.</b> The build also builds the SDK and publishes it, the examples and the research agent under <Code>/sdk</Code> and <Code>/examples</Code>, so the install commands in the dashboard work against your domain.
          <CodeBlock>{`pnpm install --frozen-lockfile
pnpm --filter @verid/web build
pnpm --filter @verid/web start        # serves on $PORT (default 3000); put it behind HTTPS`}</CodeBlock>
        </li>
        <li><b>On Vercel:</b> import the repository, set the Root Directory to <Code>apps/web</Code>, enable “Include source files outside of the Root Directory” (the build reads <Code>packages/*</Code> and <Code>examples/*</Code>), add the variables above, and deploy. The API route declares a 60-second limit for chain confirmations; a plan whose limit is shorter will need <Code>VERID_CONFIRMATION_TIMEOUT_MS</Code> lowered.</li>
        <li><b>Sign up on the live URL</b>, verify your email, create a workspace, then create an API key.</li>
        <li><b>Run the research agent against it</b> (<A href="/docs/examples" css="color:#4ADE80">Examples</A>) and confirm: the run appears, the validator passes, the receipt is anchored, and the public proof page loads without a login.</li>
        <li><b>Verify independently</b>: export the receipt and bundle and run the CLI against Arc’s RPC from a different machine.</li>
      </OL>

      <H2>4. Before real users</H2>
      <Table
        head={["CHECK", "WHY"]}
        cols="minmax(220px,1fr) minmax(0,2fr)"
        rows={[
          ["Resend domain verified, FROM address updated", "Until then only your own address receives mail, so nobody else can verify their account."],
          ["Google redirect URI for the production URL", "Otherwise Google rejects the sign-in with redirect_uri_mismatch."],
          ["HTTPS everywhere, NEXTAUTH_URL is https", "Session cookies and the CSRF origin check depend on it."],
          ["Rate limiting", "The built-in limiter is per server instance (in memory). With several instances or serverless functions it does not add up; add a shared limiter or an edge rule (for example on /api/v1/auth/* and /api/v1/public/*)."],
          ["Relayer and validator wallets funded, with an alert", "Anchoring and settlement stop if they run out of USDC for gas. Check their balances (pnpm arc:doctor) and set a low-balance alert."],
          ["Backups", "Turn on point-in-time recovery for the database (Neon has it)."],
          ["Mainnet only after testnet is proven", "Repeat the Arc deploy with a multisig owner and your explicit sign-off. Nothing here has been run on Mainnet."],
          ["Terms and privacy pages", "The sign-up page links to placeholders. Replace them before you take real sign-ups."],
          ["Rotate any secret that was pasted into a chat or committed anywhere", "Treat it as exposed."],
        ]}
      />

      <H2>5. Monitoring the deployment itself</H2>
      <UL>
        <li><Code>GET /api/v1/network/status</Code> is public and reports the backend (database) and the chain <i>separately</i>, so an Arc outage never looks like a Verid outage. Point an uptime monitor at it.</li>
        <li>Every API response carries <Code>x-request-id</Code>; internal errors are logged with the same id and never leak details to callers.</li>
        <li>Agent health inside the product is on the Agents page; see <A href="/docs/agents" css="color:#4ADE80">Agents &amp; monitoring</A>.</li>
      </UL>

      <H3>Known limits right now</H3>
      <UL>
        <li>No team invitations yet: a workspace has its owner only.</li>
        <li>The SDK and example files are served by your own server; they are not on npm or PyPI.</li>
        <li>Escrow funding has been tested against a real EVM with a wallet-style provider, but not by clicking a real wallet extension.</li>
      </UL>
    </>
  );
}
