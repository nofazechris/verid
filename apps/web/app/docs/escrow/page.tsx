import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, OL, P, Table, UL } from "@/components/docs";

export default function Escrow() {
  return (
    <>
      <H1 kicker="GUIDES">Settlement &amp; escrow</H1>
      <P>
        Escrow lets a payer lock USDC for a job and have it released automatically, and only, when the work has a passing validation and an anchored receipt. If validation fails, or the deadline passes without that proof, the payer gets the money back. It is optional: the evidence, validation and anchoring features work without it.
      </P>

      <H2>The parties</H2>
      <Table
        head={["ROLE", "WHO", "WHAT THEY DO"]}
        cols="minmax(110px,0.6fr) minmax(0,1fr) minmax(0,2fr)"
        rows={[
          ["Payer", "Whoever is paying for the work", "Approves and locks the USDC from their own wallet. Verid never holds payer keys."],
          ["Payee", "The address that should receive payment", "Receives the USDC on release. Chosen by the payer when funding."],
          ["Verid relayer", "The server", "Records the validation on-chain and triggers release or refund. It only pays gas and cannot redirect funds."],
          ["Anyone", "Any address", "May trigger release or refund once the contract allows it. Funds can only ever go to the payee or the payer."],
        ]}
      />

      <H2>The rules, enforced by the contract</H2>
      <P>These are the rules of the <Code>VeridEscrow</Code> contract. Verid’s server does not decide them; it only asks the contract.</P>
      <Table
        head={["ACTION", "ALLOWED WHEN", "FUNDS GO TO"]}
        cols="minmax(110px,0.6fr) minmax(0,2fr) minmax(110px,0.7fr)"
        rows={[
          [<Code key="1">release</Code>, <>A registered validator recorded <b key="b">Pass</b> in <Code key="v">VeridValidation</Code> <b key="b2">and</b> the receipt is anchored in <Code key="r">VeridRegistry</Code> with a Pass status. Allowed even after the deadline.</>, "Payee"],
          [<Code key="2">refund</Code>, <>The validator recorded <b key="b3">Fail</b>, <b key="b4">or</b> the deadline has passed and release conditions were never met (this includes Inconclusive, and “validated but never anchored”).</>, "Payer"],
        ]}
      />
      <UL>
        <li>Once the release conditions hold, a refund is impossible, even after the deadline. A payee who did the work cannot be starved out by waiting.</li>
        <li>The payer has <b>no early cancel</b>. Funds are committed to the validation outcome. That guarantee is what the payee relies on.</li>
        <li>No owner, admin, pause switch, fee or upgrade path on the escrow contract. Each escrow settles exactly once.</li>
        <li>Fee-on-transfer and rebasing tokens are rejected when funding. The intended token is USDC (ERC-20 interface, <b>6 decimals</b>).</li>
        <li>One escrow per execution, keyed by the execution’s on-chain key.</li>
      </UL>

      <H2>Step by step in the dashboard</H2>
      <OL>
        <li><b>Run the execution</b> as usual so it has a task to be paid for. You can fund the escrow before or after the run.</li>
        <li>Open the execution page. In the <b>USDC settlement</b> panel enter the payee address, amount and a refund deadline in days, then choose <b>Connect wallet &amp; fund</b>. Your wallet will ask twice: <i>approve</i> the escrow to take the USDC, then <i>create</i> the escrow.</li>
        <li><b>Link</b> the escrow to the execution. The dashboard does this automatically after funding if you have the developer role, or you can press <b>Link escrow</b>. Linking <i>reads</i> the payer, payee, amount and deadline from the chain; nothing is taken from what you typed.</li>
        <li>Validate, create the receipt and anchor it as usual. The panel updates as the state changes.</li>
        <li>Press <b>Settle escrow</b>. Verid first records the validation outcome on-chain, then asks the contract whether release or refund is allowed and triggers it. On confirmation the settlement shows <Code>RELEASED</Code> or <Code>REFUNDED</Code> with the transaction hash, and an execution that was anchored becomes <Code>settled</Code>.</li>
      </OL>
      <Callout title="IF IT SAYS IT CANNOT SETTLE YET">
        That is the contract’s answer, not a bug. Release needs a recorded validation Pass and an anchor; refund needs a recorded failure or an expired deadline. The panel states which applies. You can press Settle again at any time; it is safe to repeat.
      </Callout>

      <H2>Seeing all your escrows</H2>
      <P>
        The <A href="/settlements" css="color:#4ADE80">Settlements</A> page lists every escrow linked in the workspace: amount, payer, payee, status and the execution it belongs to, with totals held, released and refunded and a status filter. Open a row to go to its execution, where the live on-chain state and the Settle button are. Over the API this is <Code>GET /settlements</Code> (filter with <Code>?status=escrowed|released|refunded</Code>, paginate with <Code>cursor</Code>).
      </P>

      <H2>The same thing over the API</H2>
      <CodeBlock title="SETTLEMENT ENDPOINTS">{`# What do I need to fund it, and what is the live on-chain state?
GET  /api/v1/executions/:id/settlement
# -> { escrow: { escrowAddress, tokenAddress, chainId, executionKey, tokenDecimals: 6 },
#      settlement, onchain, readiness: { release, refund } }

# After the payer funded the escrow from their wallet, link it (developer role).
# No body needed: payer/payee/amount/deadline are read from the chain.
POST /api/v1/executions/:id/settlement

# Drive it to its next legitimate state (release or refund) and mirror it here.
POST /api/v1/executions/:id/settle
# 200 settled, 202 transaction pending (call again), 409 not allowed yet, 503 chain unavailable`}</CodeBlock>

      <H3>Funding from your own code</H3>
      <P>The payer’s two transactions are standard. Use the values from <Code>GET /executions/:id/settlement</Code>:</P>
      <CodeBlock title="TYPESCRIPT (VIEM)">{`import { erc20Abi, escrowAbi } from "@verid/arc/abi-settlement";

const { escrowAddress, tokenAddress, executionKey } = settlement.escrow;
const amount = 25_000_000n;                      // 25 USDC (6 decimals)
const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);

await wallet.writeContract({ address: tokenAddress, abi: erc20Abi, functionName: "approve", args: [escrowAddress, amount] });
await wallet.writeContract({ address: escrowAddress, abi: escrowAbi, functionName: "create", args: [executionKey, payee, amount, deadline] });`}</CodeBlock>

      <H2>How state is kept honest</H2>
      <UL>
        <li>The chain is the source of truth for funds. The dashboard shows the live on-chain read and the last recorded state, and says when the chain could not be reached.</li>
        <li>An execution reaches <Code>settled</Code> only after a confirmed release. A refund leaves the execution, including a failed validation, exactly as it was.</li>
        <li>A reverted or pending transaction is never reported as success. A pending one is finished from the chain on the next Settle.</li>
        <li>Two people pressing Settle at once move the money once.</li>
      </UL>

      <H2>What escrow does not do</H2>
      <UL>
        <li>It does not judge the work. A Pass is a recorded claim by a designated validator, and the escrow inherits that trust. Read the <A href="/docs/trust-model" css="color:#4ADE80">trust model</A> and the <A href="/docs/validators" css="color:#4ADE80">validators</A> page before putting real money behind a validator.</li>
        <li>It is not legal acceptance of the work or a dispute process. There is no human arbitration.</li>
        <li>It does not custody anything off-chain. Funds sit in the contract until the rules above are met.</li>
      </UL>

      <H2>Networks and test money</H2>
      <P>
        On Arc the token is USDC at the network’s system address, and escrow is only available where the contracts have been deployed and configured (see <A href="/docs/self-hosting" css="color:#4ADE80">Self-hosting</A>). For local development, <Code>pnpm dev:chain</Code> deploys everything on a local test chain with a free dev-only USDC, and <Code>pnpm dev:fund-escrow &lt;executionId&gt;</Code> funds an escrow without a wallet. That local chain is not Arc.
      </P>
    </>
  );
}
