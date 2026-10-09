# verid

**Record what your AI agent does, have the result checked by a server you don't control from inside the agent, and publish a verifiable receipt on [Arc](https://docs.arc.io).**

[![npm](https://img.shields.io/npm/v/verid)](https://www.npmjs.com/package/verid) · MIT · TypeScript types included · zero dependencies · Node 18+, browsers' `fetch`, edge runtimes

```bash
npm install verid
```

Contents: [What it does](#what-it-does) · [Quick start](#quick-start) · [How a run works](#how-a-run-works) · [`verid.run` reference](#veridrun-reference) · [Writing rules](#writing-rules-validators) · [Reliability](#reliability-and-errors) · [Lower-level API](#lower-level-api) · [Security](#security) · [What a receipt proves](#what-a-receipt-proves-and-what-it-does-not)

---

## What it does

Your agent keeps running wherever you run it (a script, a service, a cron job, a serverless function). With this SDK it
**reports in** each time it works:

1. what it was asked to do (the *task*),
2. every tool it called and what came back (the *evidence*),
3. what it finally produced (the *result*).

A **Verid server** stores that, applies **rules you wrote** to the result, and records a verdict: `pass`, `fail` or
`inconclusive`. Because the rules run on the server, the agent cannot mark its own homework. If the run passed, a
fingerprint (hash) of the receipt is published on Arc, so anyone you give the proof link to can recompute it and check it
against the chain without trusting you or Verid. **No task, evidence or result data goes on-chain, only hashes.**

You need a Verid server (yours or one you have an account on) and an API key from its dashboard (**Settings, API Keys**).

## Quick start

```ts
import { Verid } from "verid";

const verid = Verid.fromEnv(); // reads VERID_API_KEY and VERID_URL

export async function findStartups(topic: string, minimum = 5) {
  const out = await verid.run(
    {
      agent: "startup-finder", // shown in the dashboard; created on first use
      task: {
        description: `Find ${minimum} startups in ${topic}`,
        parameters: { minimumResults: minimum },
      },
      // The rules: data, not code. Verid's server applies them to whatever your function returns.
      validator: {
        slug: "startup-list",
        name: "Startup list",
        rules: [
          { type: "items", path: "$", min: { param: "minimumResults" } },
          { type: "required_fields", path: "$[*]", fields: ["name", "url"] },
          { type: "field_format", path: "$[*].url", format: "http_url" },
          { type: "unique", path: "$[*].url" },
          { type: "evidence", types: ["tool_call", "tool_result"] }, // it must really have used a tool
        ],
      },
    },
    // Your work. Wrap each tool call in run.tool(...) so it is recorded as evidence.
    async (run) => {
      const hits = await run.tool("web_search", { q: `${topic} startups` }, (i) => mySearch(i.q));
      return hits.map((h) => ({ name: h.title, url: h.url })); // this is what gets validated
    },
  );

  out.status;       // "pass" | "fail" | "inconclusive", decided by Verid's server
  out.anchored;     // true once the receipt is confirmed on Arc
  out.proofUrl;     // public, no-login page anyone can open to check it
  out.executionUrl; // the run in your dashboard

  if (out.status !== "pass") throw new Error("Verid rejected the result");
  return { startups: out.result, proof: out.anchored ? out.proofUrl : null };
}
```

Set two environment variables where the agent runs:

```bash
VERID_URL=https://your-verid-server.example     # the address of your Verid server (the SDK adds /api/v1)
VERID_API_KEY=verid_xxxxxxxx_...                # shown once when you create it; keep it on the server side
```

Or construct the client yourself: `new Verid({ apiKey, baseUrl })`.

A failed validation is **not an exception**: `verid.run` returns normally with `status: "fail"` and the list of `checks` so
you can decide what to do. If your own function throws, the run is recorded as `failed` (with the reason) and your error is
re-thrown.

## How a run works

| # | What happens | Stored |
|---|---|---|
| 1 | The agent record is created if it does not exist, and the **rules in your code are reconciled** with the server (see below). | Verid |
| 2 | An execution is opened and started; the task is recorded as the first piece of evidence. | Verid |
| 3 | Your function runs. Each `run.tool(...)` records a `tool_call` before and a `tool_result` after (including the error if it threw). | Verid (content + hash) |
| 4 | The returned value is sent as the result and hashed. | Verid |
| 5 | Verid's server applies the rules and records the verdict with every check listed. | Verid |
| 6 | A receipt is built: hashes of the task, the evidence (as a Merkle root), the result, the verdict and the validator version. | Verid |
| 7 | **Only if it passed:** the receipt's fingerprint is published to the registry contract on Arc by the server's relayer wallet (it pays the gas). | Arc (hashes only) |

## `verid.run` reference

```ts
verid.run<T>(options: RunOptions, fn: (run: RunContext) => Promise<T>): Promise<RunOutcome<T>>
```

### `RunOptions`

| Option | Type | Meaning |
|---|---|---|
| `agent` | `string` or `{ slug, name?, version?, description?, capabilities? }` | An agent id (`agt_…`) or a slug. A slug is created on first use. |
| `task` | `{ description: string; parameters?: Record<string, Json> }` | What the agent was asked to do. `parameters` can be read by rules. |
| `validator` | `string` or `{ slug, name, description?, rules }` | An id such as `research-validator`, `custom:my-checker` or `custom:my-checker@2`, **or** a definition with rules. |
| `anchor` | `boolean` | Publish a passing receipt on Arc. Default `true`. A server without a chain configured simply skips it. |
| `runId` | `string` | Makes the whole run idempotent. Calling again with the same id after a crash **resumes** the same execution instead of creating a new one. Default: a fresh random id. |
| `policyId` | `string` | Optional policy to run under. |

### `RunContext` (what your function receives)

| Member | Meaning |
|---|---|
| `run.tool(name, input, fn)` | Runs `fn(input)` and records a `tool_call` before and a `tool_result` after (with the error if it throws). Returns what `fn` returned. This is how the evidence stays honest: it is written around the real call. |
| `run.record(type, content)` | Records one piece of evidence yourself. `type` is `tool_call`, `tool_result`, `model_output` or `artifact`. **Do not record secrets.** Content over about 200 KB is truncated and marked as such. |
| `run.executionId` | The id of this execution. |

### `RunOutcome`

| Field | Meaning |
|---|---|
| `result` | What your function returned. |
| `status` | `"pass"`, `"fail"` or `"inconclusive"`, decided by Verid's server. |
| `checks` | Each rule's result: `{ id, description, ok, determinate, explanation? }`. |
| `anchored` | `true` only when the receipt is confirmed on-chain. |
| `anchor` / `anchorNote` | The anchor record, and, when it is not anchored, why (validation did not pass, no chain configured, still pending, …). |
| `executionId`, `receiptId` | Identifiers. |
| `validatorId`, `validatorVersion` | Which validator and exact version judged it, for example `custom:startup-list` and `2+3fa91c20be44`. |
| `executionUrl` | The run in the dashboard. |
| `proofUrl` | A public, no-login page anyone can open to verify the receipt. Only share it when `anchored` is `true`. |

## Writing rules (validators)

Rules are plain data that describe what a good result looks like. They are stored on the server as **numbered, immutable
versions** and evaluated there. Nothing in your agent can edit a verdict.

| `type` | Options | Passes when |
|---|---|---|
| `items` | `path`, `min`, `max` | The list at `path` has a length within the bounds. |
| `required_fields` | `path`, `fields[]` | Every matched object has each field present and non-empty. |
| `field_format` | `path`, `format` | Every matched value fits the format: `non_empty_string`, `http_url`, `email`, `iso_date`, `integer`, `number`, `boolean`, `non_empty_array`. |
| `number_range` | `path`, `min`, `max`, `integer` | Every matched value is a number within the bounds. |
| `one_of` | `path`, `values[]` | Every matched value is one of the listed strings, numbers or booleans. |
| `unique` | `path` | No two matched values are equal (text is compared trimmed and case-insensitively). |
| `evidence` | `types[]`, `min` | Each listed evidence type was recorded at least `min` times (default 1). |
| `evidence_count` | `min`, `max` | The number of evidence records is within the bounds. |

**Paths:** `$` is the whole result, `$.items` a field, `$[*]` every element of a list, `$[*].url` a field of each element,
`$[0]` one element.

**Parameters:** any bound can be a number or `{ "param": "name", "default": 10 }`, which reads `task.parameters.name`, so
one validator serves tasks with different thresholds.

### Changing rules is safe

The SDK sends the rules in your code on every run, and the server reconciles them:

- a new `slug` creates **version 1**;
- rules identical to an existing version create **nothing**;
- changed rules create **version N+1**; earlier versions, and every verdict they produced, never change.

Only the rules count: renaming a validator or editing its description does not create a version. The SDK then validates
with the **exact version** it was given (`custom:startup-list@3`), so during a rolling deploy or a rollback an older
deployment keeps being judged by its own rules instead of flipping the validator back and forth.

You can also build and test rules in the dashboard (Validators, with templates and a test box) and reference them by id.
`verid.validators.test({ rules, result, evidenceTypes?, taskParameters? })` dry-runs rules against a sample without storing
anything.

## Reliability and errors

- **Retries are safe.** Network errors, timeouts, `429`, `502`, `503` and `504` are retried (default 3 times, with backoff).
  Every logical call carries one idempotency key reused across its retries, so a retry can never create a duplicate.
- **Resume after a crash:** pass the same `runId` and the SDK continues the same execution.
- **Timeouts:** 30 seconds per request by default (`timeoutMs`). Anchoring can take up to about 20 seconds on the server,
  which is inside that.
- **Errors you can catch:**

```ts
import { Verid, VeridError, VeridNetworkError } from "verid";

try {
  await verid.run(/* … */);
} catch (e) {
  if (e instanceof VeridError) {
    e.status;           // HTTP status
    e.code;             // stable machine-readable code: "invalid_request", "unauthenticated", "forbidden", "not_found", "conflict", "rate_limited", "unavailable", …
    e.requestId;        // quote this when asking for support
    e.validationErrors; // string[] of rule problems when a validator definition was rejected
  } else if (e instanceof VeridNetworkError) {
    // Verid was unreachable on every attempt. Decide whether your agent should still answer (without proof) or refuse.
  } else {
    // your own function's error (the run was already recorded as failed)
  }
}
```

- **Arc slow or down:** the run is still validated and has a receipt; `out.anchorNote` says why it is not anchored yet. Call
  `verid.receipts.anchor(out.receiptId)` later; repeating it is safe.

### Client options

```ts
new Verid({
  apiKey: "verid_xxxxxxxx_...", // required
  baseUrl: "https://your-verid-server.example", // origin or the …/api/v1 root
  timeoutMs: 30_000,  // per request
  maxRetries: 3,
  fetch: customFetch, // optional (tests, proxies, older runtimes)
});
```

## Lower-level API

`verid.run` covers most agents. When you want to drive the lifecycle yourself, the same client exposes it:

| Namespace | Methods |
|---|---|
| `verid.agents` | `create`, `ensure`, `list`, `get` (includes health and monitoring), `update`, `delete` (only for an agent that never ran; otherwise archive with `update({ status: "inactive" })`) |
| `verid.validators` | `create`, `ensure`, `update` (new version), `list`, `test` |
| `verid.executions` | `create`, `start`, `addEvidence`, `complete`, `fail`, `get` |
| `verid.validations` | `run(executionId, validatorId)` |
| `verid.receipts` | `create`, `anchor`, `get`, `proofUrl` |
| `verid.settlements` | `get`, `register`, `settle`: optional USDC escrow that pays out only after a recorded pass and an anchor |
| `verid.request(method, path, body?)` | Any other endpoint of the REST API, with the same retries |

Full REST reference: `/docs/api` on your Verid server.

## Security

- **Keep the API key on the server side.** It authorises writes to your workspace. Never put it in a browser bundle, a
  mobile app or a public repository. Create one key per environment so you can revoke one without touching the others.
- **Do not record secrets or personal data as evidence.** Evidence content is stored by Verid and visible to members of your
  workspace. Only hashes go on-chain, but send only what a run needs to be checkable.
- Keys are stored hashed on the server and are workspace-bound; they can never act as an administrator.

## What a receipt proves, and what it does not

A receipt proves **integrity**: that this task, this evidence and this result were recorded, that these rules produced this
verdict, and that a fingerprint of all of it was published at a point in time that Verid cannot quietly alter afterwards.

It does **not** prove that the agent's output is *true*. Rules check structure and limits (counts, fields, formats, that a
tool was really called). Every verdict says so (`factual_claims_unverified`), and when you write the rules for your own
agent, a pass means "this satisfied the rules its author chose". Customers who need more should agree on the validator and
read which version and rules hash a receipt records.

## Also available

- **Python:** `pip install verid`, same design (`from verid import Verid`).
- **Offline or private installs:** a Verid server also serves the SDK as files at `/sdk/verid-sdk.tgz` and `/sdk/verid.py`.
- **Guide:** "Build, ship & run an agent" at `/docs/build-and-ship` on your Verid server.
- **Source and issues:** https://github.com/nofazechris/verid

## License

MIT
