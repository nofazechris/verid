import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, P, Table, UL } from "@/components/docs";
import { s } from "@/lib/style";

type Row = [method: string, path: string, role: string, description: string];

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Agents and policies",
    rows: [
      ["POST", "/agents", "developer", "Register an agent."],
      ["GET", "/agents · /agents/:id", "viewer", "List (paginated) or read."],
      ["PATCH", "/agents/:id", "developer", "Update metadata, or archive/reactivate (status inactive/active)."],
      ["DELETE", "/agents/:id", "developer", "Delete an agent that has never run. 409 once it has runs (archive it instead)."],
      ["POST", "/policies", "developer", "Create a policy (version 1)."],
      ["PATCH", "/policies/:id", "developer", "Create a NEW immutable policy version. Existing versions never change."],
      ["GET", "/policies · /policies/:id", "viewer", "List or read, with version history."],
    ],
  },
  {
    title: "Executions",
    rows: [
      ["POST", "/executions", "developer", "Create an execution. The server computes the task hash."],
      ["GET", "/executions · /executions/:id", "viewer", "List with filters (status, validation, agent, q) or read, including validation, receipt, anchor and settlement."],
      ["POST", "/executions/:id/start", "developer", "created → running."],
      ["POST", "/executions/:id/evidence", "developer", "Append one evidence record (only while running)."],
      ["GET", "/executions/:id/evidence", "viewer", "List records. includeContent=true needs the developer role."],
      ["POST", "/executions/:id/fail", "developer", "Record that the AGENT crashed or gave up (before validation). Terminal; keeps the reason."],
      ["POST", "/executions/:id/complete", "developer", "Append the result, compute the evidence root, → awaiting_validation."],
    ],
  },
  {
    title: "Validation, receipts and anchoring",
    rows: [
      ["POST", "/validations", "developer", "Run a validator server-side → validated or validation_failed."],
      ["GET", "/validations/:id", "viewer", "Read a validation with all its checks."],
      ["GET", "/validators", "viewer", "Built-in and workspace validators, their rules and your outcomes."],
      ["POST", "/validators", "developer", "Create a workspace validator from rules (version 1). Use it as custom:<slug>."],
      ["PATCH", "/validators/:slug", "developer", "Create a NEW immutable version. Pin one with custom:<slug>@<n>."],
      ["POST", "/validators/test", "developer", "Dry-run rules against a sample result. Stores nothing."],
      ["POST", "/receipts", "developer", "Generate the immutable receipt (one per execution; asking again returns it)."],
      ["GET", "/receipts · /receipts/:id", "viewer", "List or read. The confirmed anchor is merged in."],
      ["POST", "/receipts/:id/anchor", "developer", "Anchor on Arc. 200 confirmed · 202 pending · 503 chain unavailable."],
    ],
  },
  {
    title: "Settlement (USDC escrow)",
    rows: [
      ["GET", "/settlements", "viewer", "All escrows linked in the workspace, with totals by status. Filter by status, paginate with cursor."],
      ["GET", "/executions/:id/settlement", "viewer", "Funding parameters, recorded settlement, live on-chain state and readiness."],
      ["POST", "/executions/:id/settlement", "developer", "Link a funded on-chain escrow. Everything is read from the chain."],
      ["POST", "/executions/:id/settle", "developer", "Release or refund, whichever the contract allows. 200 · 202 pending · 409 not yet · 503."],
    ],
  },
  {
    title: "Workspace and account",
    rows: [
      ["GET", "/me · /workspaces", "signed-in user", "Current user and their workspaces."],
      ["POST", "/workspaces", "verified user", "Create a workspace."],
      ["GET", "/workspace · /workspace/members", "viewer", "Current workspace and members."],
      ["GET", "/overview · /activity", "viewer", "Workspace metrics (real, derived from records) and audit activity."],
      ["GET", "/onboarding", "viewer", "What this workspace has actually done so far (keys, agents, validators, runs, anchors): drives the walkthrough."],
      ["POST · GET · DELETE", "/api-keys · /api-keys/:id", "admin", "Create (shown once), list, revoke."],
    ],
  },
  {
    title: "Public (no login, rate limited per IP)",
    rows: [
      ["POST", "/receipts/verify", "public", "Verify any receipt, with an optional bundle."],
      ["GET", "/public/receipts/:id", "public", "Commitments, validator, anchor and live verification. No task, result or evidence content."],
      ["GET", "/network/status", "public", "Backend and chain health, reported separately."],
    ],
  },
];

const EXEC_REQ = `POST /api/v1/executions
Idempotency-Key: exec-7f3a9c2e

{
  "agentId": "agt_...",
  "policyId": "pol_...",                       // optional
  "task": {
    "description": "Find 10 AI startups in Nigeria founded after 2024",
    "parameters": { "foundedAfter": 2024, "minimumResults": 10 }
  }
}`;
const EXEC_RES = `201 Created
{
  "execution": {
    "id": "exe_...", "status": "created",
    "taskHash": "0x...",                       // computed by the server
    "createdAt": "2026-10-01T12:00:00.000Z", ...
  }
}`;
const EVID = `POST /api/v1/executions/:id/evidence
{ "type": "tool_call", "content": { "tool": "search", "query": "..." } }

201 Created
{ "evidence": { "id": "evd_...", "sequenceNumber": 1, "type": "tool_call",
                "contentHash": "0x...", "evidenceTimestamp": "2026-10-01T12:00:01.000Z" } }
// "content" is never echoed back, and never shown to viewer keys.`;
const VAL = `POST /api/v1/validations
{ "executionId": "exe_...", "validatorId": "research-validator" }

201 Created
{ "validation": { "id": "val_...", "status": "pass" | "fail" | "inconclusive",
                  "validatorId": "research-validator", "validatorVersion": "1.0.0",
                  "checks": [ { "id": "min_entries", "description": "...", "ok": true, "determinate": true } ],
                  "resultHash": "0x..." },
  "executionStatus": "validated" | "validation_failed" }`;
const ANCHOR = `POST /api/v1/receipts/:id/anchor

200 OK  (confirmed)   202 Accepted (submitted, not yet mined; call again)
{ "receipt": { ..., "anchor": { "network": "...", "chainId": 5042, "registryAddress": "0x...",
                                "transactionHash": "0x...", "blockNumber": 123 } },
  "anchor": { "status": "confirmed" | "submitted" | "reverted", ... },
  "alreadyAnchored": false }`;
const SETTLE = `GET /api/v1/executions/:id/settlement
{ "executionStatus": "anchored",
  "escrow": { "configured": true, "escrowAddress": "0x...", "tokenAddress": "0x...", "chainId": 5042,
              "network": "arc-mainnet", "executionKey": "0x...", "tokenDecimals": 6 },
  "settlement": null | { "status": "escrowed" | "released" | "refunded", "amount": "25000000",
                         "requesterAddress": "0x...", "recipientAddress": "0x...", "deadline": 1790000000,
                         "releaseTxHash": "0x..." | null, "refundTxHash": "0x..." | null },
  "onchain": { "status": "none" | "funded" | "released" | "refunded", "payer": "0x...", "payee": "0x...",
               "amount": "25000000", "deadline": 1790000000 },
  "readiness": { "release": true, "refund": false } | null }
// amounts are base units: 25000000 = 25 USDC (6 decimals)`;
const ERR = `{ "error": { "code": "invalid_state", "message": "only a validated execution can be anchored (is 'running')" } }`;

export default function Api() {
  return (
    <>
      <H1 kicker="REFERENCE">REST API</H1>
      <P>
        Base path <Code>/api/v1</Code>. JSON in, JSON out. Everything the dashboard does is one of these calls. Most developers should use the <A href="/docs/sdk" css="color:#4ADE80">SDK</A>, which calls these for you. Start with the <A href="/docs" css="color:#4ADE80">Quickstart</A> for a guided run, or <A href="/docs/integrate" css="color:#4ADE80">Connect your agent</A>.
      </P>

      <H2>Conventions</H2>
      <Table
        head={["TOPIC", "RULE"]}
        cols="minmax(150px,0.6fr) minmax(0,2.4fr)"
        rows={[
          ["Authentication", <>Send <Code key="a">authorization: Bearer verid_xxxxxxxx_…</Code>. See <A key="l" href="/docs/authentication" css="color:#4ADE80">Authentication</A>. Every request is scoped to one workspace.</>],
          ["Roles", "viewer (read), developer (read and write), admin (manage keys), owner. Checked on the server for every call."],
          ["Content type", <>Send <Code key="c">content-type: application/json</Code>. Bodies over 3 MB are rejected (<Code key="p">413</Code>).</>],
          ["Pagination", <>Lists use keyset pagination: <Code key="q">?limit=25&amp;cursor=…</Code>. Responses are <Code key="d">{`{ "data": [...], "nextCursor": "..." | null }`}</Code>.</>],
          ["Idempotency", <>Send <Code key="i">Idempotency-Key</Code> (8–200 chars) on creates, evidence and validations. Same key and body replays the original response (<Code key="r">Idempotent-Replay: true</Code>); same key, different body is <Code key="u">422</Code>.</>],
          ["Rate limits", <>600 requests per minute per key or user; public routes 30 per minute per IP; auth routes 10 per minute per IP. Exceeding returns <Code key="t">429</Code> with <Code key="ra">Retry-After</Code>.</>],
          ["Request ID", <>Every response carries <Code key="x">x-request-id</Code>. Quote it when reporting a problem.</>],
          ["Timestamps", "ISO 8601 UTC strings. Evidence timestamps are assigned by the server."],
          ["Amounts", "Token amounts are integer strings in base units. USDC has 6 decimals: \"25000000\" is 25 USDC."],
        ]}
      />

      <H2>Errors</H2>
      <CodeBlock title="SHAPE">{ERR}</CodeBlock>
      <Table
        head={["CODE", "HTTP", "MEANING"]}
        cols="minmax(170px,0.9fr) minmax(60px,0.3fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">invalid_request</Code>, "400", "Malformed body, failed validation, unknown validator or unsupported method."],
          [<Code key="2">unauthenticated</Code>, "401", "Missing, invalid, expired or revoked credentials."],
          [<Code key="3">forbidden</Code>, "403", "Your role is too low for this call."],
          [<Code key="4">email_not_verified</Code>, "403", "Verify your email before using workspaces."],
          [<Code key="5">not_found</Code>, "404", "No such record in your workspace (other workspaces’ records look identical)."],
          [<Code key="6">conflict</Code>, "409", "Already exists, for example a settlement already linked."],
          [<Code key="7">invalid_state</Code>, "409", "The execution’s state does not allow this call."],
          [<Code key="8">idempotency_conflict</Code>, "422", "Idempotency-Key reused with a different body."],
          [<Code key="9">payload_too_large</Code>, "413", "Body, evidence or result over the limit."],
          [<Code key="10">rate_limited</Code>, "429", "Slow down; honour Retry-After."],
          [<Code key="11">unavailable</Code>, "503", "The chain or another dependency is unreachable or not configured. Safe to retry."],
          [<Code key="12">internal</Code>, "500", "A bug on our side. Nothing internal is exposed; use the request ID."],
        ]}
      />

      <H2>Execution lifecycle</H2>
      <div style={s("font-family:'Geist Mono',monospace;font-size:13px;color:#C8D0CB;line-height:1.9;max-width:900px;overflow-wrap:anywhere")}>
        created → running → evidence_captured → awaiting_validation → validated → anchoring → anchored → settling → settled
        <br />
        <span style={{ color: "#D08A8A" }}>awaiting_validation → validation_failed</span> <span style={{ color: "#7C847F" }}>(terminal, preserved, never anchored, never released)</span>
        <br />
        <span style={{ color: "#7C847F" }}>anchoring → validated when an anchor transaction reverts (safe to retry)</span>
      </div>
      <P>
        Illegal transitions return <Code>409 invalid_state</Code>. Nothing moves to <Code>validated</Code>, <Code>anchored</Code> or <Code>settled</Code> because a client asked: each transition is backed by a validator result or a confirmed chain event.
      </P>

      <H2>Endpoint index</H2>
      {GROUPS.map((g) => (
        <div key={g.title} style={s("display:flex;flex-direction:column;gap:10px")}>
          <H3>{g.title}</H3>
          <div style={s("border:1px solid #252B27;border-radius:12px;background:#101311;max-width:960px;overflow-x:auto")}>
            <div style={{ minWidth: 640 }}>
              {g.rows.map(([m, p, r, d]) => (
                <div key={m + p} style={s("display:grid;grid-template-columns:110px minmax(210px,1fr) 100px minmax(0,1.5fr);gap:14px;align-items:center;min-height:44px;padding:8px 18px;border-bottom:1px solid #161A18;font-size:13px")}>
                  <span style={s("font-family:'Geist Mono',monospace;font-size:11.5px;color:#4ADE80")}>{m}</span>
                  <span style={s("font-family:'Geist Mono',monospace;font-size:12.5px;overflow-wrap:anywhere")}>{p}</span>
                  <span style={s("font-family:'Geist Mono',monospace;font-size:11px;color:#7C847F")}>{r}</span>
                  <span style={s("color:#9BA39E")}>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      <H2>Examples</H2>
      <H3>Create an execution</H3>
      <CodeBlock title="REQUEST">{EXEC_REQ}</CodeBlock>
      <CodeBlock title="RESPONSE">{EXEC_RES}</CodeBlock>
      <H3>Record evidence</H3>
      <P>Types: <Code>task</Code>, <Code>tool_call</Code>, <Code>tool_result</Code>, <Code>model_output</Code>, <Code>artifact</Code>. Optional <Code>contentReference</Code> (up to 500 characters) and <Code>metadata</Code> are stored but not committed. Content is limited to 256 KB, results to 1 MB, and an execution to 500 records.</P>
      <CodeBlock title="EXCHANGE">{EVID}</CodeBlock>
      <H3>Validate</H3>
      <CodeBlock title="EXCHANGE">{VAL}</CodeBlock>
      <H3>Anchor</H3>
      <CodeBlock title="EXCHANGE">{ANCHOR}</CodeBlock>
      <H3>Settlement</H3>
      <CodeBlock title="EXCHANGE">{SETTLE}</CodeBlock>
      <P>See <A href="/docs/escrow" css="color:#4ADE80">Settlement &amp; escrow</A> for the rules behind <Code>readiness</Code> and the settle call.</P>

      <H2>Public verification endpoint</H2>
      <CodeBlock title="REQUEST">{`POST /api/v1/receipts/verify
{ "receipt": { ... }, "bundle": { "task": {...}, "policy": {...}, "evidence": [...], "result": ..., "validation": {...} } }   // bundle optional

200 OK
{ "outcome": "verified" | "incomplete" | "invalid",
  "checks": [ { "id": "schema", "label": "Receipt schema", "status": "VALID", "detail": "..." }, ... ] }`}</CodeBlock>
      <Callout title="THIS IS NOT INDEPENDENT">
        This endpoint runs on a Verid server, so it trusts that server’s chain connection. For verification that does not rely on us, use the <A href="/docs/cli" css="color:#4ADE80">command-line tool</A> against your own RPC.
      </Callout>

      <H2>Good practice</H2>
      <UL>
        <li>Keep API keys server-side. Use a <Code>viewer</Code> key for read-only dashboards.</li>
        <li>Derive idempotency keys from your own run IDs so a retry after a timeout is always safe.</li>
        <li>Treat only a confirmed anchor as proof. A <Code>202</Code> or a <Code>submitted</Code> anchor is not.</li>
        <li>Branch on the stable <Code>error.code</Code>, not on the message text.</li>
      </UL>
    </>
  );
}
