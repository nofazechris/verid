import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, OL, P, Table, UL } from "@/components/docs";

const RUN = `# 1. Create an API key in the dashboard (Settings → API Keys). Copy it; it is shown once.
# 2. Download the example from your Verid server and run it:
curl -O https://YOUR-HOST/examples/github-research.mjs

VERID_URL=https://YOUR-HOST/api/v1 \\
VERID_API_KEY=verid_xxxxxxxx_... \\
node github-research.mjs ai-agents 5`;

const OUTPUT = `1. Make sure the validator and the agent exist in Verid
   created validator custom:github-repo-list (version 1)
   agent GitHub Researcher (agt_vnXs4SbypjOOkp6heKne_Q)

2. Tell Verid a job is starting
   execution exe_wVn7Z5JPxeYg-orgTssB4w

3. Do the real work, recording each call as evidence
   GitHub returned 5 repositories (of 106703 matches)

4. Hand Verid the result and let it validate
   outcome: PASS  (validator custom:github-repo-list @ 1+0f20b7c8ed94)
   ✓ $ has at least task parameter "minimumResults" (default 3) items
   ✓ Every $[*] has: name, url, stars, createdAt, createdYear
   ✓ Every $[*].url is a valid http url
   ✓ Every $[*].createdAt is a valid iso date
   ✓ Every $[*].stars is a whole number ≥ 0
   ✓ Every $[*].createdYear is a whole number ≥ task parameter "createdAfterYear"
   ✓ No duplicate values at $[*].url
   ✓ Evidence includes task, tool_call, tool_result, result
   · Rules check structure and limits only; the truth of the content was NOT independently confirmed
   · These rules were written by the workspace that ran this execution, not by Verid

5. Create the receipt
   receipt rcpt_xqmqUEK-T18jv_kgzDB6Rw

6. Anchor the receipt's fingerprints on the chain
   confirmed  tx 0xf24786bb1ba409dbc08df08e472e24f3d08bb1ee837b9495679c07d7dc2ed9c1

Done. Look at it:
  Dashboard : https://YOUR-HOST/executions/exe_wVn7Z5JPxeYg-orgTssB4w
  Public proof (shareable, no login): https://YOUR-HOST/proof/rcpt_xqmqUEK-T18jv_kgzDB6Rw`;

const VALIDATOR = `const RULES = [
  // at least N repositories, where N comes from the task's own parameters
  { type: "items", path: "$", min: { param: "minimumResults", default: 3 } },
  // every entry has these fields, non-empty
  { type: "required_fields", path: "$[*]", fields: ["name", "url", "stars", "createdAt", "createdYear"] },
  { type: "field_format", path: "$[*].url", format: "http_url" },
  { type: "field_format", path: "$[*].createdAt", format: "iso_date" },
  { type: "number_range", path: "$[*].stars", min: 0, integer: true },
  { type: "number_range", path: "$[*].createdYear", min: { param: "createdAfterYear" }, integer: true },
  { type: "unique", path: "$[*].url" },
  // the run must have recorded these kinds of evidence
  { type: "evidence", types: ["task", "tool_call", "tool_result", "result"] },
];
await verid("POST", "/validators", { slug: "github-repo-list", name: "GitHub repository list checker", rules: RULES });`;

const EVIDENCE = `// Before calling GitHub: record WHAT the agent is about to do.
await verid("POST", "/executions/" + id + "/evidence",
  { type: "tool_call", content: { tool: "github.search_repositories", method: "GET", url } });

const response = await fetch(url);          // <- the real work
const body = await response.json();

// After: record exactly WHAT CAME BACK.
await verid("POST", "/executions/" + id + "/evidence",
  { type: "tool_result", content: { status: response.status, items: body.items } });`;

const LLM = `import Anthropic from "@anthropic-ai/sdk";
import { Verid } from "verid";

const verid = Verid.fromEnv();
const claude = new Anthropic();

const out = await verid.run(
  {
    agent: "ticket-summariser",
    task: { description: "Summarise a support ticket in 3 bullets", parameters: { bullets: 3 } },
    validator: "custom:summary-checker",   // 3 bullets, each non-empty. Build it from a template in Validators.
  },
  async (run) => {
    // Your model call is untouched; run.tool records it before and after.
    const msg = await run.tool("claude.messages.create", { model: "claude-sonnet-5-5", chars: ticketText.length }, () =>
      claude.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 400,
        messages: [{ role: "user", content: "Summarise in 3 bullets:\\n" + ticketText }],
      }),
    );
    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    await run.record("model_output", { text });
    return text.split("\\n").filter((l) => l.trim().startsWith("-")).map((l) => ({ bullet: l.replace(/^-\\s*/, "") }));
  },
);`;

const RESEARCH_RUN = `# Get the agent (three small files) from your Verid server and install the SDK
mkdir research-agent && cd research-agent
curl -O https://YOUR-HOST/examples/research-agent/agent.mjs
curl -O https://YOUR-HOST/examples/research-agent/server.mjs
curl -O https://YOUR-HOST/examples/research-agent/package.json
npm install verid

# Run it once on a real topic (Node 18+). Create the key in Settings → API Keys.
VERID_URL=https://YOUR-HOST VERID_API_KEY=verid_xxxxxxxx_... node server.mjs --once "solid state batteries"`;

const RESEARCH_SERVICE = `VERID_URL=https://YOUR-HOST VERID_API_KEY=verid_xxxxxxxx_... AGENT_ACCESS_TOKEN=pick-a-long-random-string node server.mjs

# open http://localhost:8787 in a browser, or call it:
curl -X POST http://localhost:8787/research \\
  -H "authorization: Bearer pick-a-long-random-string" -H "content-type: application/json" \\
  -d '{"topic":"fusion power"}'
# -> { "status": "pass", "anchored": true, "summary": "...", "findings": [...], "proofUrl": "https://YOUR-HOST/proof/rcpt_..." }`;

const RESEARCH_CODE = `const outcome = await verid.run(
  { agent: { slug: "research-agent", name: "Research Agent" }, task, validator: VALIDATOR },
  async (run) => {
    // Two independent tools, run in parallel. Each becomes its own tool_call and tool_result in the evidence.
    const [wiki, hn] = await Promise.allSettled([
      run.tool("wikipedia.search_and_extract", { topic, limit: 4 }, wikipedia),
      run.tool("hackernews.search", { topic, limit: 4 }, hackerNews),
    ]);
    const findings = dedupe([...ok(wiki), ...ok(hn)]);
    if (!findings.length) throw new Error("no sources found");   // the run is recorded as FAILED, with this reason

    // Claude if a key is set, otherwise quote the sources. Either way the call is recorded.
    const summary = process.env.ANTHROPIC_API_KEY
      ? await run.tool("anthropic.messages", { topic }, () => claudeBrief(topic, findings))
      : extractiveBrief(topic, findings);
    return { topic, method: process.env.ANTHROPIC_API_KEY ? "llm" : "extractive", summary, findings };
  },
);`;

export default function Examples() {
  return (
    <>
      <H1 kicker="GET STARTED">Examples</H1>
      <P>
        Working code you can run today. These are <b style={{ color: "#E8ECE9", fontWeight: 500 }}>real agents</b>: they call real public APIs, record everything they do, and go through the whole Verid lifecycle against your own server. Nothing is mocked or pre-filled.
      </P>

      <H2>Example 1: the research agent (run it, or deploy it)</H2>
      <P>
        A complete agent, not a snippet. Give it a topic and it searches <b style={{ color: "#E8ECE9", fontWeight: 500 }}>Wikipedia</b> and <b style={{ color: "#E8ECE9", fontWeight: 500 }}>Hacker News</b> (public APIs, no keys), then writes a brief that cites its sources. Add an <Code>ANTHROPIC_API_KEY</Code> and Claude writes the brief from only the gathered sources; without one it quotes them. Every search is recorded as evidence, the result is validated on Verid’s server against a “cited research brief” rule set, and a passing run is anchored on Arc.
      </P>
      <H3>Run it once (about two minutes)</H3>
      <CodeBlock title="TERMINAL">{RESEARCH_RUN}</CodeBlock>
      <P>You get the brief, the sources, Verid’s verdict with each rule, and two links: the run in your dashboard and a public proof page. Give it a topic with no sources (try gibberish) and the agent throws; the SDK records that run as <i>failed</i> with the reason, and it appears as the agent’s last failure.</P>

      <H3>Run it as a web service, and deploy it</H3>
      <P>The same agent is also a small HTTP service with a one-page UI, so you can put it on a host and test it from a browser or with <Code>curl</Code>.</P>
      <CodeBlock title="LOCALLY">{RESEARCH_SERVICE}</CodeBlock>
      <Table
        head={["WHERE", "HOW"]}
        cols="minmax(150px,0.7fr) minmax(0,2fr)"
        rows={[
          ["Any Node 18+ host", <>Copy the folder, run <Code key="a">npm install</Code> then <Code key="b">node server.mjs</Code>, and set the environment variables below.</>],
          ["Docker", <><Code key="a">docker build -t research-agent .</Code> then <Code key="b">docker run -p 8787:8787 -e VERID_URL=… -e VERID_API_KEY=… research-agent</Code>. The folder includes a <Code key="c">Dockerfile</Code>.</>],
          ["Render, Railway, Fly…", <>The folder includes a <Code key="a">render.yaml</Code>. Any host that runs Node works; these hosts were not tested by the Verid project.</>],
        ]}
      />
      <Table
        head={["VARIABLE", "REQUIRED", "WHAT"]}
        cols="minmax(190px,0.9fr) minmax(90px,0.5fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">VERID_URL</Code>, "Yes", "Your Verid server, for example https://verid.example.com. The deployed agent must be able to reach it."],
          [<Code key="2">VERID_API_KEY</Code>, "Yes", "A key from Settings → API Keys (developer role)."],
          [<Code key="3">AGENT_ACCESS_TOKEN</Code>, "Strongly advised", "Callers must send Authorization: Bearer <token>. Without it anyone who finds the URL can spend your API calls and fill your workspace with runs."],
          [<Code key="4">ANTHROPIC_API_KEY</Code>, "No", "Use Claude to write the brief. Not needed to try the agent."],
          [<Code key="5">PORT</Code>, "No", "Default 8787."],
        ]}
      />
      <Callout title="BEFORE YOU EXPOSE IT TO THE INTERNET">
        Set <Code>AGENT_ACCESS_TOKEN</Code>. The service has a small per-IP rate limit and input limits, but each request does real work (public API calls, a Verid execution, a chain transaction). Keep your Verid API key in the host’s secret store, never in the repository.
      </Callout>

      <H3>What you will see in the dashboard</H3>
      <UL>
        <li><b>Agents:</b> “Research Agent” with its health, runs, pass rate and, after a failure, the exact reason.</li>
        <li><b>Validators:</b> <Code>custom:research-brief</Code>, labelled “defined by this workspace”, with the rules in plain language.</li>
        <li><b>The run:</b> the evidence timeline (the Wikipedia call, its answer, the Hacker News call, its answer), the validator’s verdict, the receipt and the anchor.</li>
        <li><b>The public proof page:</b> what you would send a customer.</li>
      </UL>
      <H3>How the agent uses the SDK (the whole integration)</H3>
      <CodeBlock title="agent.mjs (EXCERPT)">{RESEARCH_CODE}</CodeBlock>
      <P>That is it: the agent’s own logic is unchanged. <Code>run.tool</Code> wraps each real call, the function returns the result, and Verid does the rest.</P>

      <H2>Example 2: a minimal real agent (GitHub), start to finish</H2>
      <P>
        The task: <i>“Find 5 popular GitHub repositories for the topic <Code>ai-agents</Code> created in 2023 or later.”</i> The agent calls GitHub’s public search API, so what it records is genuinely what GitHub returned. It needs only Node 18+ (or Python 3.8+), no packages and no GitHub account.
      </P>
      <CodeBlock title="RUN IT">{RUN}</CodeBlock>
      <P>Python instead: <Code>github-research.py</Code> from the same folder behaves identically and uses only the standard library.</P>

      <H3>What you will see</H3>
      <CodeBlock title="OUTPUT (REAL RUN)">{OUTPUT}</CodeBlock>

      <H3>What it created, and where to look in the dashboard</H3>
      <Table
        head={["WHAT", "WHERE", "WHAT TO NOTICE"]}
        cols="minmax(150px,0.8fr) minmax(130px,0.7fr) minmax(0,2fr)"
        rows={[
          ["Agent", <A key="a" href="/agents" css="color:#4ADE80">Agents</A>, "“GitHub Researcher” appears with its execution count."],
          ["Validator", <A key="v" href="/validators" css="color:#4ADE80">Validators</A>, <>A new <Code key="c">custom:github-repo-list</Code> labelled “defined by this workspace”, with its rules in plain language and a rules hash.</>],
          ["Execution", <A key="e" href="/executions" css="color:#4ADE80">Executions</A>, "The graph shows task, evidence, validator and Arc stages filled in from real records. Click a stage to inspect it."],
          ["Evidence", "Execution → Evidence stage", "Four records: the task, the GitHub call, GitHub’s answer and the result. Only hashes are shown; the content stays private."],
          ["Receipt", <A key="r" href="/receipts" css="color:#4ADE80">Receipts</A>, "The portable record of fingerprints. “Verify now” recomputes everything and reads the chain."],
          ["Public proof", "/proof/<receipt id>", "The page you would send a customer. No login, no private data."],
        ]}
      />

      <H3>How it works, in four pieces</H3>
      <P><b style={{ color: "#E8ECE9", fontWeight: 500 }}>1. The validator is rules as data.</b> Before the run, the script tells Verid what a good result looks like. Verid evaluates this on its own server, so the agent cannot grade itself.</P>
      <CodeBlock title="THE VALIDATOR (RULES)">{VALIDATOR}</CodeBlock>
      <P><b style={{ color: "#E8ECE9", fontWeight: 500 }}>2. Evidence wraps the real work.</b> The agent reports each call before and after it happens. Verid hashes the content and stamps it with the server’s clock, so it cannot be back-dated or quietly edited later.</P>
      <CodeBlock title="RECORDING A TOOL CALL">{EVIDENCE}</CodeBlock>
      <P><b style={{ color: "#E8ECE9", fontWeight: 500 }}>3. Validation is decided by the server.</b> The script cannot say “pass”; it can only ask Verid to run the validator over what was recorded. A failure is preserved forever.</P>
      <P><b style={{ color: "#E8ECE9", fontWeight: 500 }}>4. Anchoring publishes fingerprints, not data.</b> Only if validation passed, Verid writes the receipt’s hashes to the Arc blockchain. Anyone can later check the receipt against the chain without trusting Verid.</P>

      <H3>See a failure</H3>
      <CodeBlock>{`node github-research.mjs rust-lang 4 --simulate-bad-result`}</CodeBlock>
      <P>
        This deliberately corrupts one entry. The validator catches it (<Code>not a valid http url: $[0].url</Code>), the execution becomes <Code>validation_failed</Code>, and Verid refuses to anchor it or release any escrow. Run the script again and you get a <i>new</i> execution; the failed one stays exactly as it was.
      </P>

      <Callout title="WHAT THIS DOES AND DOES NOT PROVE">
        The receipt proves GitHub’s answer, the agent’s list and the validator’s verdict are exactly what was recorded, and when. It does <b>not</b> prove GitHub told the truth, or that these are the “best” repositories. The validator checks structure and limits, and says so in its own output.
      </Callout>

      <H2>Example 3: wrap an agent you already have</H2>
      <P>
        Real agents are functions, loops or frameworks, not scripts. With the <A href="/docs/sdk" css="color:#4ADE80">SDK</A>, wrapping one is a single call: put the agent’s body inside <Code>verid.run</Code> and route each real call through <Code>run.tool</Code>. Your own logic does not change.
      </P>
      <CodeBlock title="TYPESCRIPT, WITH AN LLM">{LLM}</CodeBlock>
      <P>This is a <i>pattern</i>: it assumes you have the Anthropic SDK and a validator for your task (the <A href="/validators" css="color:#4ADE80">Validators</A> page has templates for common shapes). It is not something Verid runs for you.</P>

      <H2>Example 4: get paid only when it is proven</H2>
      <P>A customer wants the research done but does not want to pay up front. You do not want to work for free. Escrow fixes both.</P>
      <OL>
        <li>The customer opens your execution page and funds a USDC escrow from their wallet, naming your address as the payee (<A href="/docs/escrow" css="color:#4ADE80">Settlement &amp; escrow</A>).</li>
        <li>Your agent runs (Example 1 or 2). If it passes validation, its receipt is anchored on Arc.</li>
        <li>Anyone presses <b>Settle</b>. The contract checks that a validator recorded a Pass <i>and</i> the receipt is anchored. Only then does it send the USDC to you; otherwise it returns to the customer.</li>
      </OL>
      <P>The customer sees the same public proof page you do, so “did the work get done?” is something they can check rather than take your word for.</P>

      <H2>Example 5: verify someone else’s receipt</H2>
      <P>You are the customer, auditor or skeptic. You were sent two files, <Code>receipt.json</Code> and <Code>bundle.json</Code>, and you do not trust the sender or Verid.</P>
      <CodeBlock>{`node packages/cli/bin/verid.mjs receipt verify receipt.json --bundle bundle.json \\
  --rpc https://rpc.testnet.arc.io --registry 0xf3c38d1fad1ea30ef59e515598dc3b72854142c9`}</CodeBlock>
      <P>
        It recomputes every hash and reads the Arc chain directly. <Code>VERIFICATION COMPLETE</Code> means the receipt is genuine and unchanged; anything else is reported honestly as invalid or incomplete. See <A href="/docs/cli" css="color:#4ADE80">Command-line tool</A>.
      </P>

      <H2>Your own agent next</H2>
      <UL>
        <li>Copy the structure of Example 1 and replace the GitHub call with whatever your agent does.</li>
        <li>Create a validator for your output shape (<A href="/docs/validators" css="color:#4ADE80">Validators</A>). Start with the item count and required fields, then tighten.</li>
        <li>Record the calls that matter to your customer. Do not record secrets.</li>
        <li>Full reference: <A href="/docs/integrate" css="color:#4ADE80">Connect your agent</A> and the <A href="/docs/api" css="color:#4ADE80">REST API</A>.</li>
      </UL>
    </>
  );
}
