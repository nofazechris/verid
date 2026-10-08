import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, P, Table, UL } from "@/components/docs";

const INSTALL_NODE = `# Your Verid server hosts the SDK, so there is nothing to sign up for.
curl -O https://YOUR-HOST/sdk/verid-sdk.tgz
npm install ./verid-sdk.tgz`;

const INSTALL_PY = `curl -O https://YOUR-HOST/sdk/verid.py      # one file, standard library only, Python 3.8+`;

const RUN_NODE = `import { Verid } from "@verid/sdk";

const verid = new Verid({ apiKey: process.env.VERID_API_KEY, baseUrl: "https://YOUR-HOST" });
// or: const verid = Verid.fromEnv();   // reads VERID_API_KEY and VERID_URL

const out = await verid.run(
  {
    agent: "research-agent",                        // created on first use
    task: { description: "Research solid state batteries", parameters: { minimumFindings: 3 } },
    validator: {                                    // rules as data; new version if you change them
      slug: "research-brief",
      name: "Cited research brief",
      rules: [
        { type: "items", path: "$.findings", min: { param: "minimumFindings", default: 3 } },
        { type: "required_fields", path: "$.findings[*]", fields: ["title", "url"] },
        { type: "field_format", path: "$.findings[*].url", format: "http_url" },
        { type: "evidence", types: ["tool_call", "tool_result"] },
      ],
    },
  },
  async (run) => {
    // Recorded as a tool_call BEFORE and a tool_result AFTER the real call:
    const pages = await run.tool("wikipedia.search", { q: "solid state batteries" }, (i) => searchWikipedia(i.q));
    await run.record("model_output", { note: "ranked by relevance" });   // anything else worth proving
    return { findings: pages.map((p) => ({ title: p.title, url: p.url })) };   // the result Verid validates
  },
);

out.status;       // "pass" | "fail" | "inconclusive": decided on Verid's server, not by your code
out.anchored;     // true once the receipt is confirmed on Arc
out.checks;       // every rule, with the exact values that failed
out.proofUrl;     // a public, no-login page you can send to a customer
out.executionUrl; // the same run in your dashboard`;

const RUN_PY = `import os
from verid import Verid

verid = Verid(os.environ["VERID_API_KEY"], "https://YOUR-HOST")

def work(run):
    pages = run.tool("wikipedia.search", {"q": "solid state batteries"}, lambda i: search_wikipedia(i["q"]))
    return {"findings": [{"title": p["title"], "url": p["url"]} for p in pages]}

out = verid.run(
    agent="research-agent",
    task={"description": "Research solid state batteries"},
    validator={"slug": "research-brief", "name": "Cited research brief", "rules": [
        {"type": "items", "path": "$.findings", "min": 3},
        {"type": "field_format", "path": "$.findings[*].url", "format": "http_url"},
        {"type": "evidence", "types": ["tool_call", "tool_result"]},
    ]},
    fn=work,
)
print(out.status, out.anchored, out.proof_url)`;

const FAIL = `try {
  await verid.run({ agent: "research-agent", task, validator: "custom:research-brief" }, async (run) => {
    await run.tool("search", { q }, () => { throw new Error("upstream 500"); });
  });
} catch (e) {
  // The run is ALREADY recorded in Verid as failed, with the reason "upstream 500",
  // so it shows up in the agent's health instead of vanishing. Your error is rethrown untouched.
}`;

export default function Sdk() {
  return (
    <>
      <H1 kicker="GET STARTED">SDK</H1>
      <P>
        The SDK turns the REST API into one call. You wrap the work your agent already does in <Code>verid.run(...)</Code>; the SDK creates the execution, records each tool call as evidence, sends the result for validation on Verid’s server, creates the receipt and anchors it. It has <b style={{ color: "#E8ECE9", fontWeight: 500 }}>no dependencies</b>, and everything it does is also available as plain HTTP.
      </P>
      <Table
        head={["PACKAGE", "FOR", "INSTALL"]}
        cols="minmax(130px,0.7fr) minmax(0,1fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">@verid/sdk</Code>, "Node 18+, browsers' fetch, edge runtimes (TypeScript types included)", <Code key="a">npm install ./verid-sdk.tgz</Code>],
          [<Code key="2">verid.py</Code>, "Python 3.8+ (one file, standard library only)", <Code key="b">curl -O https://YOUR-HOST/sdk/verid.py</Code>],
        ]}
      />
      <Callout title="NOT ON NPM OR PYPI YET">
        Your own Verid server hosts both, so no account anywhere is needed. Download, then install the <i>file</i> (installing straight from a URL is blocked by some npm configurations, which is why the commands download first). Publishing to npm and PyPI is a later step; the package is already built to be published.
      </Callout>

      <H2>Install</H2>
      <CodeBlock title="NODE.JS">{INSTALL_NODE}</CodeBlock>
      <CodeBlock title="PYTHON">{INSTALL_PY}</CodeBlock>
      <P>Create an API key in the dashboard (Settings → API Keys) and keep it in an environment variable on the machine that runs your agent. Never put it in front-end code.</P>

      <H2>The one call: <Code>verid.run</Code></H2>
      <CodeBlock title="TYPESCRIPT">{RUN_NODE}</CodeBlock>
      <CodeBlock title="PYTHON">{RUN_PY}</CodeBlock>

      <H3>What it does, in order</H3>
      <UL>
        <li>Finds or creates the <b>agent</b> by its handle, and the <b>validator</b> if you passed rules. Both are safe to repeat on every start-up.</li>
        <li>Opens an <b>execution</b> and records the task as the first piece of evidence.</li>
        <li>Runs your function. <Code>run.tool(name, input, fn)</Code> records a <Code>tool_call</Code>, calls your <Code>fn</Code>, then records the <Code>tool_result</Code> (or the error). Use <Code>run.record(type, content)</Code> for anything else.</li>
        <li>Sends the return value as the <b>result</b>, asks Verid’s server to <b>validate</b> it, creates the <b>receipt</b>, and, only if it passed, <b>anchors</b> it on Arc.</li>
      </UL>

      <H3>When your function throws</H3>
      <CodeBlock title="TYPESCRIPT">{FAIL}</CodeBlock>

      <H3>Options</H3>
      <Table
        head={["OPTION", "MEANING"]}
        cols="minmax(150px,0.7fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">agent</Code>, <>An id (<Code key="a">agt_…</Code>) or a handle. With a handle, pass <Code key="b">{`{ slug, name, version, capabilities }`}</Code> to set details on first creation.</>],
          [<Code key="2">validator</Code>, <>An id (<Code key="a">research-validator</Code>, <Code key="b">custom:my-checker</Code>, or pinned <Code key="c">custom:my-checker@2</Code>), or a definition <Code key="d">{`{ slug, name, rules }`}</Code>. A definition is created only if that slug is new; existing rules are never silently changed.</>],
          [<Code key="3">anchor</Code>, "Default true. Set false to skip anchoring. A server with no chain configured just reports it in anchorNote."],
          [<Code key="4">runId</Code>, "Make the run resumable: calling again with the same id after a crash continues the same execution instead of creating a duplicate."],
        ]}
      />

      <H2>Safety built in</H2>
      <UL>
        <li><b>Retries never duplicate.</b> Network errors, 429 and 502/503/504 are retried with backoff, and every retry reuses one idempotency key.</li>
        <li><b>Timeouts.</b> A hung request is cut off after 30 seconds (configurable) instead of hanging your agent.</li>
        <li><b>Big outputs.</b> A tool output over about 200 KB is recorded as a truncated marker (with its original size) instead of failing the run.</li>
        <li><b>You cannot self-certify.</b> There is no way to submit a verdict; the SDK only asks the server to run the validator.</li>
      </UL>

      <H2>Lower-level methods</H2>
      <P>Everything <Code>run()</Code> uses is available directly, for when you need control:</P>
      <Table
        head={["NAMESPACE", "METHODS"]}
        cols="minmax(130px,0.6fr) minmax(0,2.4fr)"
        rows={[
          [<Code key="1">verid.agents</Code>, <><Code key="a">create</Code>, <Code key="b">ensure</Code>, <Code key="c">list</Code>, <Code key="d">get</Code> (includes monitoring), <Code key="e">update</Code>, <Code key="f">delete</Code> (only if it never ran)</>],
          [<Code key="2">verid.validators</Code>, <><Code key="a">create</Code>, <Code key="b">ensure</Code>, <Code key="c">update</Code> (new version), <Code key="d">list</Code>, <Code key="e">test</Code> (dry run)</>],
          [<Code key="3">verid.executions</Code>, <><Code key="a">create</Code>, <Code key="b">start</Code>, <Code key="c">addEvidence</Code>, <Code key="d">complete</Code>, <Code key="e">fail</Code>, <Code key="f">get</Code></>],
          [<Code key="4">verid.validations</Code>, <Code key="a">run</Code>],
          [<Code key="5">verid.receipts</Code>, <><Code key="a">create</Code>, <Code key="b">anchor</Code>, <Code key="c">get</Code>, <Code key="d">proofUrl</Code></>],
          [<Code key="6">verid.settlements</Code>, <><Code key="a">get</Code>, <Code key="b">register</Code>, <Code key="c">settle</Code></>],
        ]}
      />
      <P>
        Errors are <Code>VeridError</Code> (with <Code>status</Code>, the stable <Code>code</Code>, <Code>details</Code> and the <Code>requestId</Code>) or <Code>VeridNetworkError</Code> when the server could not be reached at all. A rejected validator definition lists every problem in <Code>error.validationErrors</Code>.
      </P>

      <H2>SDK or plain HTTP?</H2>
      <P>
        They do the same thing: the SDK only calls the <A href="/docs/api" css="color:#4ADE80">REST API</A> for you and adds retries, safe idempotency and the <Code>run()</Code> helper. Use HTTP directly from any other language; the lifecycle is seven calls. A React component package is not built yet.
      </P>
      <P>See it working end to end in <A href="/docs/examples" css="color:#4ADE80">Examples</A>, and learn how health and monitoring work in <A href="/docs/agents" css="color:#4ADE80">Agents &amp; monitoring</A>.</P>
    </>
  );
}
