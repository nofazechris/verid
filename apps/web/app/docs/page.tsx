import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, P } from "@/components/docs";

export default function Quickstart() {
  return (
    <>
      <H1 kicker="QUICKSTART">Record one execution, end to end.</H1>
      <P>
        This walks through the full lifecycle with the REST API: register an agent, run an execution, record evidence, complete it, validate it, generate a receipt, and anchor it.
        You need an API key (<A href="/settings/keys" css="color:#4ADE80">Settings → API Keys</A>) and a workspace.
      </P>
      <Callout title="FASTEST WAY IN">
        In the dashboard, open <b>Get started</b> for a guided walkthrough, or run a <b>real, deployable research agent</b> in two minutes: <A href="/docs/examples" css="color:#4ADE80">Examples</A>. With Node or Python, the <A href="/docs/sdk" css="color:#4ADE80">SDK</A> does everything on this page in one call. The rest of this page does the same thing by hand, one API call at a time, which is also how you integrate from any other language.
      </Callout>
      <Callout title="NEW HERE?">
        Read <A href="/docs/overview" css="color:#4ADE80">What is Verid?</A> first for the big picture, then <A href="/docs/agents" css="color:#4ADE80">Agents &amp; monitoring</A> to see how you will watch your agents.
      </Callout>

      <H2>0. Set up</H2>
      <CodeBlock>{`export VERID=https://your-verid-host/api/v1
export KEY=verid_xxxxxxxx_...        # shown once when you create it`}</CodeBlock>

      <H2>1. Register an agent</H2>
      <CodeBlock>{`curl -s -X POST $VERID/agents -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"slug":"researchbot","name":"ResearchBot","version":"1.0.0","capabilities":["web.search"]}'`}</CodeBlock>

      <H2>2. Create and start an execution</H2>
      <P>The server computes the task commitment. Send an <Code>Idempotency-Key</Code> so a retry never creates a duplicate.</P>
      <CodeBlock>{`curl -s -X POST $VERID/executions -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" -H "idempotency-key: run-2026-10-01-a" \\
  -d '{"agentId":"agt_...","task":{"description":"Find 10 AI startups in Nigeria founded after 2024",
        "parameters":{"foundedAfter":2024,"minimumResults":10}}}'

curl -s -X POST $VERID/executions/$EXEC/start -H "authorization: Bearer $KEY"`}</CodeBlock>

      <H2>3. Record evidence</H2>
      <P>Allowed types: <Code>task</Code>, <Code>tool_call</Code>, <Code>tool_result</Code>, <Code>model_output</Code>, <Code>artifact</Code>. Content is hashed server-side; the timestamp is assigned by the server. Raw content is stored off-chain and never published.</P>
      <CodeBlock>{`curl -s -X POST $VERID/executions/$EXEC/evidence -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"type":"tool_call","content":{"tool":"search","query":"AI startups in Nigeria"}}'`}</CodeBlock>

      <H2>4. Complete, validate, receipt</H2>
      <CodeBlock>{`# result: [{ "name", "website", "foundedYear", "sources": [...] }, ...]
curl -s -X POST $VERID/executions/$EXEC/complete -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" -d '{"result":[ ... ]}'

curl -s -X POST $VERID/validations -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"executionId":"'$EXEC'","validatorId":"research-validator"}'

curl -s -X POST $VERID/receipts -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" -d '{"executionId":"'$EXEC'"}'`}</CodeBlock>
      <P>The validator runs on the server. You cannot submit an outcome yourself. A failed validation is preserved, is terminal, and cannot be anchored; retry by creating a new execution.</P>

      <H2>5. Anchor on Arc</H2>
      <CodeBlock>{`curl -s -X POST $VERID/receipts/$RECEIPT/anchor -H "authorization: Bearer $KEY"`}</CodeBlock>
      <P>
        Returns <Code>200</Code> when confirmed, <Code>202</Code> while pending (call again to re-check), and <Code>503</Code> if the chain is unreachable or not configured.
        A submitted transaction is never reported as confirmed until it is mined.
      </P>

      <H2>6. Optional: pay on proof</H2>
      <P>
        Lock USDC for the execution from the payer’s wallet, link it, and settle after anchoring. It releases to the payee only when the validation passed and the receipt is anchored, and refunds the payer otherwise. See <A href="/docs/escrow" css="color:#4ADE80">Settlement &amp; escrow</A>.
      </P>
      <CodeBlock>{`curl -s $VERID/executions/$EXEC/settlement -H "authorization: Bearer $KEY"          # funding parameters + live state
curl -s -X POST $VERID/executions/$EXEC/settlement -H "authorization: Bearer $KEY"   # link the funded escrow
curl -s -X POST $VERID/executions/$EXEC/settle -H "authorization: Bearer $KEY"       # release or refund`}</CodeBlock>

      <H2>7. Verify independently</H2>
      <P>
        Export the receipt and verification bundle from the receipt page, then verify against the chain without trusting the dashboard. See <A href="/docs/verification" css="color:#4ADE80">Receipts &amp; verification</A> and the <A href="/docs/cli" css="color:#4ADE80">command-line tool</A>.
      </P>
    </>
  );
}
