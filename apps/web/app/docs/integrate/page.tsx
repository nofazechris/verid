import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, OL, P, Table, UL } from "@/components/docs";

const TS = `// verid.ts: a small client over the REST API. Needs Node 18+ (global fetch).
const BASE = process.env.VERID_URL!;      // e.g. https://your-host/api/v1
const KEY = process.env.VERID_API_KEY!;   // verid_xxxxxxxx_...

export class VeridError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function call<T = any>(method: string, path: string, body?: unknown, idem?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: "Bearer " + KEY,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(idem ? { "idempotency-key": idem } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new VeridError(res.status, json?.error?.code ?? "error", json?.error?.message ?? "request failed");
  return json as T;
}

export const verid = {
  createExecution: (agentId: string, task: object, runId: string) =>
    call("POST", "/executions", { agentId, task }, "exec-" + runId),
  start: (id: string) => call("POST", "/executions/" + id + "/start"),
  evidence: (id: string, type: "task" | "tool_call" | "tool_result" | "model_output" | "artifact", content: unknown, key: string) =>
    call("POST", "/executions/" + id + "/evidence", { type, content }, key),
  complete: (id: string, result: unknown, runId: string) =>
    call("POST", "/executions/" + id + "/complete", { result }, "done-" + runId),
  validate: (id: string, validatorId: string, runId: string) =>
    call("POST", "/validations", { executionId: id, validatorId }, "val-" + runId),
  receipt: (id: string) => call("POST", "/receipts", { executionId: id }),
  anchor: (receiptId: string) => call("POST", "/receipts/" + receiptId + "/anchor"),
};`;

const TS_RUN = `import { randomUUID } from "node:crypto";
import { verid } from "./verid";

export async function runWithProof(agentId: string, task: { description: string; parameters?: object }) {
  const runId = randomUUID();
  const { execution } = await verid.createExecution(agentId, task, runId);
  await verid.start(execution.id);

  await verid.evidence(execution.id, "task", task, runId + "-task");   // record the task as the first record

  // ---- your agent does its real work here, reporting each step as it goes ----
  const query = { tool: "search", query: "AI startups in Nigeria" };
  await verid.evidence(execution.id, "tool_call", query, runId + "-0");
  const hits = await mySearchTool(query);                       // <- your code
  await verid.evidence(execution.id, "tool_result", hits, runId + "-1");
  const result = await myAgentSummarise(hits);                  // <- your code
  // ---------------------------------------------------------------------------

  await verid.complete(execution.id, result, runId);
  const { validation, executionStatus } = await verid.validate(execution.id, "research-validator", runId);
  if (validation.status !== "pass") return { result, proven: false, reason: validation, execution };

  const { receipt } = await verid.receipt(execution.id);
  const anchored = await verid.anchor(receipt.receiptId);        // 200 confirmed, 202 pending
  return { result, proven: true, receiptId: receipt.receiptId, anchor: anchored.anchor };
}`;

const PY = `# verid.py: the same client in Python (pip install requests)
import os, uuid, requests

BASE = os.environ["VERID_URL"]            # https://your-host/api/v1
KEY = os.environ["VERID_API_KEY"]         # verid_xxxxxxxx_...

class VeridError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message); self.status, self.code = status, code

def call(method, path, body=None, idem=None):
    headers = {"authorization": "Bearer " + KEY}
    if idem: headers["idempotency-key"] = idem
    r = requests.request(method, BASE + path, json=body, headers=headers, timeout=30)
    data = r.json() if r.content else {}
    if not r.ok:
        e = data.get("error", {})
        raise VeridError(r.status_code, e.get("code", "error"), e.get("message", "request failed"))
    return data

def run_with_proof(agent_id, task, work):
    run = str(uuid.uuid4())
    ex = call("POST", "/executions", {"agentId": agent_id, "task": task}, "exec-" + run)["execution"]
    call("POST", "/executions/%s/start" % ex["id"])

    n = 0
    def record(kind, content):                      # pass this to your agent so it can report steps
        nonlocal n
        call("POST", "/executions/%s/evidence" % ex["id"], {"type": kind, "content": content}, "%s-%d" % (run, n))
        n += 1

    record("task", task)                            # record the task as the first record
    result = work(record)                           # <- your agent runs here and calls record(...)
    call("POST", "/executions/%s/complete" % ex["id"], {"result": result}, "done-" + run)
    v = call("POST", "/validations", {"executionId": ex["id"], "validatorId": "research-validator"}, "val-" + run)
    if v["validation"]["status"] != "pass":
        return result, None
    rcpt = call("POST", "/receipts", {"executionId": ex["id"]})["receipt"]
    anchored = call("POST", "/receipts/%s/anchor" % rcpt["receiptId"])
    return result, rcpt["receiptId"]`;

export default function Integrate() {
  return (
    <>
      <H1 kicker="GET STARTED">Connect your agent</H1>
      <P>
        Connecting an agent means wrapping the work it already does so it reports to Verid. Verid never runs your agent and never needs your model keys or credentials. It only receives what you choose to send.
      </P>
      <Callout title="THE EASY WAY: THE SDK">
        If you use Node or Python, the <A href="/docs/sdk" css="color:#4ADE80">SDK</A> does everything on this page in one call, <Code>verid.run(...)</Code>, with retries and idempotency built in. A complete, deployable example is in <A href="/docs/examples" css="color:#4ADE80">Examples</A>. This page explains what happens underneath, and is the reference for any other language: it shows the same lifecycle as plain HTTP, with small helpers you can paste.
      </Callout>

      <H2>Before you start</H2>
      <OL>
        <li>Sign up, verify your email and create a workspace in the dashboard.</li>
        <li>Open <A href="/settings/keys" css="color:#4ADE80">Settings → API Keys</A> and create a <Code>developer</Code> key. It is shown once; store it as a secret in your agent’s environment, never in front-end code.</li>
        <li>Register your agent once (the dashboard’s Agents page, or <Code>POST /agents</Code>). Note its <Code>id</Code> (<Code>agt_…</Code>).</li>
        <li>Optionally create a policy (<Code>POST /policies</Code>) to record which rules governed the run.</li>
      </OL>

      <H2>The pattern</H2>
      <Table
        head={["STEP", "CALL", "WHEN"]}
        cols="minmax(150px,0.8fr) minmax(0,1.4fr) minmax(0,1.4fr)"
        rows={[
          ["Create", <Code key="1">POST /executions</Code>, "Once per job, before the agent starts."],
          ["Start", <Code key="2">POST /executions/:id/start</Code>, "Immediately before work begins."],
          ["Record evidence", <Code key="3">POST /executions/:id/evidence</Code>, "After every tool call and tool result you want to be provable."],
          ["Complete", <Code key="4">POST /executions/:id/complete</Code>, "When the agent has its final result."],
          ["Validate", <Code key="5">POST /validations</Code>, "Right after completing. The server decides the outcome."],
          ["Receipt", <Code key="6">POST /receipts</Code>, "After validation, pass or fail."],
          ["Anchor", <Code key="7">POST /receipts/:id/anchor</Code>, "Only if validation passed. Publishes the fingerprints on Arc."],
        ]}
      />

      <H2>TypeScript</H2>
      <CodeBlock title="verid.ts">{TS}</CodeBlock>
      <CodeBlock title="run-agent.ts">{TS_RUN}</CodeBlock>

      <H2>Python</H2>
      <CodeBlock title="verid.py">{PY}</CodeBlock>

      <H2>What to record as evidence</H2>
      <P>
        Record what a reviewer would need to see to believe the result: which tools were called with which inputs, and what came back. Types you send: <Code>task</Code> (record the task text as the first record), <Code>tool_call</Code>, <Code>tool_result</Code>, <Code>model_output</Code>, <Code>artifact</Code>. The server appends the <Code>result</Code> record itself when you complete the execution.
      </P>
      <UL>
        <li>Content is hashed on the server, and the timestamp is assigned by the server, so evidence cannot be back-dated.</li>
        <li>The content you send is stored privately and is never published. Only hashes reach the chain.</li>
        <li>Order matters. Records are numbered 0, 1, 2… in the order they are accepted, and the number is part of the commitment.</li>
        <li>Do not send secrets (API keys, passwords, personal data) as evidence. If something must be referred to, send a reference or a hash of it instead. <Code>contentReference</Code> and <Code>metadata</Code> are stored but <b>not</b> committed.</li>
      </UL>

      <H2>Limits</H2>
      <Table
        head={["LIMIT", "VALUE"]}
        cols="minmax(0,1.4fr) minmax(0,1fr)"
        rows={[
          ["Evidence content per record", "256 KB"],
          ["Result", "1 MB"],
          ["Evidence records per execution", "500"],
          ["Request body", "3 MB"],
          ["Authenticated requests", "600 per minute per key or user"],
          ["Public endpoints", "30 per minute per IP"],
        ]}
      />

      <H2>Handling failures</H2>
      <H3>Retries are safe, if you send an Idempotency-Key</H3>
      <P>
        Network calls fail. Send a stable <Code>Idempotency-Key</Code> (8–200 characters) on every create, evidence and validation call, derived from your own run ID as in the helpers above. If a request is retried with the same key and body you get the original response back (header <Code>Idempotent-Replay: true</Code>) instead of a duplicate. The same key with a different body returns <Code>422</Code>.
      </P>
      <H3>Common responses</H3>
      <Table
        head={["STATUS / CODE", "MEANING", "WHAT TO DO"]}
        cols="minmax(150px,0.8fr) minmax(0,1.3fr) minmax(0,1.4fr)"
        rows={[
          [<Code key="a">400 invalid_request</Code>, "Body failed validation.", "Fix the request; do not retry unchanged."],
          [<Code key="b">401 unauthenticated</Code>, "Missing or invalid key.", "Check the key and that it has not been revoked or expired."],
          [<Code key="c">403 forbidden</Code>, "Key role too low (for example a viewer key).", "Use a developer key."],
          [<Code key="d">409 invalid_state</Code>, "The execution is not in a state that allows this call.", "Follow the lifecycle order. A validation_failed execution is final."],
          [<Code key="e">413 payload_too_large</Code>, "A size limit was exceeded.", "Send less, or send a hash and a reference."],
          [<Code key="f">429 rate_limited</Code>, "Too many requests.", "Wait for the Retry-After header."],
          [<Code key="g">503 unavailable</Code>, "The chain or a dependency is unreachable or not configured.", "Retry later. Anchoring is idempotent."],
        ]}
      />

      <H2>When validation fails</H2>
      <P>
        A failed or inconclusive validation is a real, preserved outcome. The execution becomes <Code>validation_failed</Code>, which is terminal: it cannot be re-validated, anchored or overwritten. To try again, run the job again as a <i>new</i> execution. This is intentional: if a failure could be quietly replaced by a later pass, the record would be worthless.
      </P>

      <H2>When anchoring is pending</H2>
      <P>
        <Code>POST /receipts/:id/anchor</Code> returns <Code>200</Code> once the transaction is confirmed and <Code>202</Code> while it is still pending. On <Code>202</Code>, call it again later; it re-checks and never sends a duplicate transaction. Treat a receipt as proven only when the response carries a confirmed anchor.
      </P>

      <H2>Sharing the proof</H2>
      <UL>
        <li><b>Public link.</b> <Code>/proof/&lt;receiptId&gt;</Code> shows commitments, validator, anchor and a live verification, with no private content and no login.</li>
        <li><b>Receipt and bundle.</b> Export both from the receipt page and hand them to anyone who wants to verify without trusting Verid. See <A href="/docs/verification" css="color:#4ADE80">Receipts &amp; verification</A>.</li>
      </UL>

      <H2>Getting paid on proof</H2>
      <P>
        If the work is being paid for, the payer can lock USDC in escrow for the execution before or during the run. It releases to the payee only after the validation passes and the receipt is anchored. See <A href="/docs/escrow" css="color:#4ADE80">Settlement &amp; escrow</A>.
      </P>
    </>
  );
}
