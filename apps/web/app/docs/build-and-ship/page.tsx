import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, OL, P, Table, UL } from "@/components/docs";

const B = ({ children }: { children: React.ReactNode }) => <b style={{ color: "#E8ECE9", fontWeight: 500 }}>{children}</b>;

const INSTALL = `npm install verid        # TypeScript / JavaScript
pip install verid        # Python (one file, no dependencies)`;

const AGENT = `// agent.ts: YOUR agent. Verid is not in charge of running this; it only receives reports.
import { Verid } from "verid";

const verid = Verid.fromEnv();   // reads VERID_URL and VERID_API_KEY from the environment

export async function findStartups(topic: string, minimum = 5) {
  const out = await verid.run(
    {
      agent: "startup-finder",                              // the name shown in the dashboard
      task: { description: \`Find \${minimum} startups in \${topic}\`, parameters: { minimumResults: minimum } },

      // THE RULES. Data, not code. Verid's server applies them to whatever your function returns.
      validator: {
        slug: "startup-list",
        name: "Startup list",
        rules: [
          { type: "items", path: "$", min: { param: "minimumResults" } },
          { type: "required_fields", path: "$[*]", fields: ["name", "url"] },
          { type: "field_format", path: "$[*].url", format: "http_url" },
          { type: "unique", path: "$[*].url" },
          { type: "evidence", types: ["tool_call", "tool_result"] },   // it must have actually used a tool
        ],
      },
    },

    // YOUR WORK. Wrap each tool call in run.tool(...) so it is recorded as evidence.
    async (run) => {
      const hits = await run.tool("web_search", { q: \`\${topic} startups\` }, (i) => mySearch(i.q));
      return hits.map((h) => ({ name: h.title, url: h.url }));      // this is the result that gets validated
    },
  );

  // Verid has decided. Your code decides what to do with the verdict.
  if (out.status !== "pass") throw new Error("Verid rejected this result: " + out.checks.filter((c) => !c.ok).map((c) => c.description).join("; "));
  return { startups: out.result, proof: out.anchored ? out.proofUrl : null };
}`;

const PY = `# agent.py: the same thing in Python (pip install verid)
from verid import Verid
verid = Verid.from_env()

def find_startups(topic, minimum=5):
    def work(run):
        hits = run.tool("web_search", {"q": f"{topic} startups"}, lambda i: my_search(i["q"]))
        return [{"name": h["title"], "url": h["url"]} for h in hits]

    out = verid.run(
        agent="startup-finder",
        task={"description": f"Find {minimum} startups in {topic}", "parameters": {"minimumResults": minimum}},
        validator={"slug": "startup-list", "name": "Startup list", "rules": [
            {"type": "items", "path": "$", "min": {"param": "minimumResults"}},
            {"type": "required_fields", "path": "$[*]", "fields": ["name", "url"]},
            {"type": "evidence", "types": ["tool_call", "tool_result"]},
        ]},
        fn=work,
    )
    if out.status != "pass":
        raise RuntimeError("Verid rejected this result")
    return out.result, (out.proof_url if out.anchored else None)`;

const ENV = `# On your laptop (a .env file or your shell) and, as secrets, on whatever host runs the agent
VERID_URL=https://YOUR-VERID-HOST          # the address of your Verid server (the SDK adds /api/v1)
VERID_API_KEY=verid_xxxxxxxx_...           # Settings -> API Keys. Shown once. Never commit it, never ship it to a browser.`;

export default function BuildAndShip() {
  return (
    <>
      <H1 kicker="GET STARTED">Build, ship and run an agent</H1>
      <P>
        This page follows one agent from the first line of code to production, and says exactly what happens at each step, who does it, and where the data goes. If you read one page, read this one.
      </P>

      <Callout title="THE ONE IDEA">
        Verid <B>does not run your agent</B>, and it does not watch your git repository or your deploys. Your agent runs wherever you put it and <B>reports to Verid over HTTPS each time it works</B>. Verid records the report, judges the result with rules, and publishes a fingerprint on Arc. Pushing code changes nothing in Verid until the next run.
      </Callout>

      <H2>The four pieces</H2>
      <Table
        head={["PIECE", "WHO RUNS IT", "WHAT IT DOES"]}
        cols="minmax(130px,0.7fr) minmax(0,1fr) minmax(0,2.2fr)"
        rows={[
          [<B key="1">Your agent</B>, "You (any host, any language, any model)", "Does the actual work. Calls the SDK to report what it was asked, each tool it used, and its answer."],
          [<B key="2">The SDK</B>, "Inside your agent's process", "A thin client for the Verid REST API: records evidence, retries safely, returns the verdict. Installing it does nothing on its own."],
          [<B key="3">The Verid server</B>, "Verid (or you, self-hosted)", "Stores the run, applies the rules, creates the receipt, and pays the gas to publish it on Arc. This is where the rules live."],
          [<B key="4">Arc</B>, "The chain", "Holds a fingerprint (hash) of the receipt. No task, evidence or result data goes on-chain."],
        ]}
      />

      <H2>Step 1: get a key and set two variables</H2>
      <OL>
        <li>In the dashboard open <B>Settings, API Keys</B> and create a key with the <Code>developer</Code> role. It is shown once. Make one key per environment (laptop, staging, production) so you can revoke one without touching the others.</li>
        <li>Give your agent two environment variables:</li>
      </OL>
      <CodeBlock title="ENVIRONMENT">{ENV}</CodeBlock>
      <P>The key tells Verid <B>which workspace</B> the run belongs to. That is the whole connection: no webhook, no registration step, no config file in Verid.</P>

      <H2>Step 2: write the agent, with its rules next to it</H2>
      <CodeBlock title="INSTALL">{INSTALL}</CodeBlock>
      <CodeBlock title="TYPESCRIPT">{AGENT}</CodeBlock>
      <CodeBlock title="PYTHON">{PY}</CodeBlock>
      <H3>Who sets the rules, and where do they live?</H3>
      <P>
        You do, in the <Code>validator</Code> option, as plain data (rule types are listed in <A href="/docs/validators" css="color:#4ADE80">Validators</A>). On each run the SDK sends the rules to Verid, which stores them as numbered, immutable versions in your workspace and applies them <B>on its own server</B> to the result your function returns. Your agent never evaluates its own rules, so it cannot mark its own homework. You can also build and test rules in the dashboard (Validators, with templates and a test box) and reference them by id, for example <Code>validator: &quot;custom:startup-list&quot;</Code>.
      </P>
      <Callout title="WHAT RULES CAN AND CANNOT PROVE">
        Rules check structure and limits: how many items, which fields, which formats, no duplicates, that a tool was really called. They do <B>not</B> check that the content is true (Verid says so in every verdict). And if you write the rules for your own agent, a pass means &ldquo;this satisfied the rules its author chose&rdquo;. That is useful, but a customer who needs more than that should agree on the validator, and read which version and rules hash a receipt records.
      </Callout>

      <H2>Step 3: run it once locally</H2>
      <P>
        Point <Code>VERID_URL</Code> at your Verid server (local or hosted), run your agent once, and open the printed <Code>executionUrl</Code> in the dashboard. You should see the task, each tool call as evidence, the verdict with every check, and the receipt. If the server has Arc configured and the run passed, it is anchored and you get a <Code>proofUrl</Code> anyone can open. This is the same path production uses, so if it works here it works there.
      </P>

      <H2>Step 4: push it</H2>
      <P>
        Deploy the agent the way you deploy anything else (Render, Fly, a VM, Lambda, a cron job). Put <Code>VERID_URL</Code> and <Code>VERID_API_KEY</Code> in the host&rsquo;s secret settings. <B>That is all the connecting there is.</B> Verid learns about your agent the first time it runs: the SDK creates the agent record and the validator if they do not exist yet.
      </P>
      <Callout title="WHAT HAPPENS AT PUSH TIME">
        Nothing, as far as Verid can see. It has no link to GitHub or your host. Your platform builds and starts the new code; Verid hears from it again the next time something triggers a run (a request, a schedule, a queue message, you). Verid does not trigger, schedule or host agents.
      </Callout>

      <H2>What happens on every run</H2>
      <Table
        head={["#", "WHAT HAPPENS", "WHERE IT IS STORED"]}
        cols="minmax(30px,0.2fr) minmax(0,2.4fr) minmax(0,1.4fr)"
        rows={[
          ["1", <>The SDK makes sure the <B key="a">agent</B> exists (created on first use) and the <B key="b">rules</B> match your code (see below).</>, "Verid database"],
          ["2", "It opens an execution, marks it started, and records the task as the first piece of evidence.", "Verid database"],
          ["3", <>Your function runs. Each <Code key="c">run.tool(...)</Code> records a <Code key="d">tool_call</Code> before the call and a <Code key="e">tool_result</Code> after it (including the error, if it threw).</>, "Verid database (content and hash)"],
          ["4", "Your function returns the result. The SDK sends it to Verid and Verid hashes it.", "Verid database"],
          ["5", <>Verid&rsquo;s server applies the rules and records <B key="f">pass</B>, <B key="g">fail</B> or <B key="h">inconclusive</B>, with every check listed.</>, "Verid database"],
          ["6", "Verid builds the receipt: hashes of the task, the evidence (as a Merkle root), the result, the verdict, and which validator version judged it.", "Verid database"],
          ["7", <>Only if it <B key="i">passed</B>: Verid&rsquo;s relayer wallet publishes the receipt&rsquo;s fingerprint to the registry contract on Arc, and waits for confirmation (deterministic finality, a few seconds). Verid pays the gas.</>, "Arc (hashes only)"],
          ["8", <>Your code gets back <Code key="j">status</Code>, <Code key="k">checks</Code>, <Code key="l">anchored</Code>, <Code key="m">executionUrl</Code>, <Code key="n">proofUrl</Code>.</>, "Your process"],
        ]}
      />
      <P>
        <B>How this relates to the Arc transaction:</B> the transaction in step 7 is the only on-chain part. It does not move your data or your money; it publishes a fingerprint at a point in time that Verid cannot quietly alter afterwards. Whoever you give the <Code>proofUrl</Code> to can recompute the hashes from the receipt and compare them with the chain, with no need to trust you or Verid. If the run is paid for, the optional <A href="/docs/escrow" css="color:#4ADE80">escrow</A> contract releases USDC only after a recorded pass and an anchor.
      </P>

      <H2>When you change the code or the rules and push again</H2>
      <UL>
        <li><B>Same rules:</B> nothing changes. The SDK finds the existing version and uses it.</li>
        <li><B>You edited the rules:</B> on the next run the SDK sends them, the server sees they differ and creates <B>version N+1</B>. Older versions and every verdict they produced stay exactly as they were.</li>
        <li><B>Only the name or description changed:</B> no new version. Identity is the rules hash.</li>
        <li><B>Old and new deployments overlap</B> (a rolling deploy, or you roll back): each instance validates with the version that matches <B>its own</B> rules (the SDK pins <Code>custom:startup-list@2</Code> and so on), so neither flips the other.</li>
        <li>Receipts record the validator version and rules hash, so you can always tell which rules judged a run.</li>
      </UL>

      <H2>Running it for real</H2>
      <H3>What can go wrong, and what you see</H3>
      <Table
        head={["SITUATION", "WHAT HAPPENS"]}
        cols="minmax(0,1.3fr) minmax(0,2.5fr)"
        rows={[
          ["Your function throws", <>The run is recorded as <B key="a">failed</B> with the error message (so it shows on the dashboard instead of vanishing), and the error is re-thrown to you.</>],
          ["The result breaks a rule", <><Code key="a">out.status</Code> is <Code key="b">fail</Code> (not an exception). The run is preserved as it happened and can never be anchored or paid out.</>],
          ["Verid is unreachable or returns 429/5xx", "The SDK retries with the same idempotency key, so nothing can duplicate. If it still fails it throws. Decide whether your agent should then still answer (without proof) or refuse."],
          ["Your process dies mid-run", <>Call again with the same <Code key="a">runId</Code> and the SDK resumes the same execution instead of starting a new one.</>],
          ["Arc is slow or down", <>The run is still validated and has a receipt; <Code key="a">out.anchorNote</Code> says why it is not anchored yet. Call <Code key="b">verid.receipts.anchor(receiptId)</Code> later to retry; it is safe to repeat.</>],
        ]}
      />
      <H3>Watching it</H3>
      <P>
        The <A href="/agents" css="color:#4ADE80">Agents</A> page shows each agent&rsquo;s health (healthy, degraded or failing), recent pass rate, a 14-day chart and the reason of its last failure. See <A href="/docs/agents" css="color:#4ADE80">Agents &amp; monitoring</A>.
      </P>
      <H3>Before you call it production</H3>
      <UL>
        <li>The key is in the host&rsquo;s secret store, one key per environment, with only the role it needs.</li>
        <li><B>Do not record secrets or personal data as evidence.</B> Evidence content is stored by Verid and shown on the run page; only hashes go to Arc. Keep it to what the run needs to be checkable.</li>
        <li>Your code handles <Code>status !== &quot;pass&quot;</Code> on purpose: retry, escalate, or refuse to present the result as verified.</li>
        <li>You open the <Code>proofUrl</Code> of a real run in a private window to see what your customer sees.</li>
        <li>If you self-host Verid, you went through <A href="/docs/deploy-app" css="color:#4ADE80">Host Verid (go live)</A>.</li>
      </UL>

      <H2>What Verid does not do</H2>
      <UL>
        <li>It does not host, start, schedule or restart your agent.</li>
        <li>It does not read your code or your repository.</li>
        <li>It does not decide whether the content of a result is true, only whether it satisfies the rules and was recorded as it happened.</li>
        <li>It never puts your data on-chain.</li>
      </UL>
    </>
  );
}
