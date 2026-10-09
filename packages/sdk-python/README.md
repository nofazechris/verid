# verid (Python)

**Record what your AI agent does, have the result checked by a server you don't control from inside the agent, and publish a verifiable receipt on [Arc](https://docs.arc.io).**

One file, standard library only, Python 3.8+. The same design as the npm package [`verid`](https://www.npmjs.com/package/verid).

```bash
pip install verid
```

## What it does

Your agent keeps running wherever you run it (a script, a service, a cron job). With this SDK it **reports in** each time it
works: what it was asked to do (the *task*), every tool it called and what came back (the *evidence*), and what it produced
(the *result*).

A **Verid server** stores that, applies **rules you wrote** to the result, and records a verdict: `pass`, `fail` or
`inconclusive`. Because the rules run on the server, the agent cannot mark its own homework. If the run passed, a
fingerprint (hash) of the receipt is published on Arc, so anyone you give the proof link to can check it against the chain
without trusting you or Verid. **No task, evidence or result data goes on-chain, only hashes.**

You need a Verid server and an API key from its dashboard (**Settings, API Keys**).

## Quick start

```python
from verid import Verid

verid = Verid.from_env()            # reads VERID_API_KEY and VERID_URL

def find_startups(topic, minimum=5):
    def work(run):
        # Wrap each tool call in run.tool(...) so it is recorded as evidence.
        hits = run.tool("web_search", {"q": f"{topic} startups"}, lambda i: my_search(i["q"]))
        return [{"name": h["title"], "url": h["url"]} for h in hits]    # this is what gets validated

    out = verid.run(
        agent="startup-finder",                                          # created on first use
        task={"description": f"Find {minimum} startups in {topic}", "parameters": {"minimumResults": minimum}},
        validator={                                                      # the rules: data, not code
            "slug": "startup-list",
            "name": "Startup list",
            "rules": [
                {"type": "items", "path": "$", "min": {"param": "minimumResults"}},
                {"type": "required_fields", "path": "$[*]", "fields": ["name", "url"]},
                {"type": "field_format", "path": "$[*].url", "format": "http_url"},
                {"type": "unique", "path": "$[*].url"},
                {"type": "evidence", "types": ["tool_call", "tool_result"]},
            ],
        },
        fn=work,
    )

    out.status          # "pass" | "fail" | "inconclusive", decided by the Verid server, not your code
    out.anchored        # True once the receipt is confirmed on Arc
    out.proof_url       # public, no-login page anyone can open to check it
    out.execution_url   # the run in your dashboard
    if out.status != "pass":
        raise RuntimeError("Verid rejected the result")
    return out.result, (out.proof_url if out.anchored else None)
```

Environment variables where the agent runs:

```bash
VERID_URL=https://your-verid-server.example     # the address of your Verid server (the SDK adds /api/v1)
VERID_API_KEY=verid_xxxxxxxx_...                # shown once when you create it; keep it on the server side
```

Or construct the client yourself: `Verid(api_key, base_url)`.

A failed validation is **not an exception**: `verid.run` returns normally with `status == "fail"` and the list of `checks`.
If your own function raises, the run is recorded as `failed` (with the reason) and your exception is re-raised.

## `verid.run(...)` reference

```python
verid.run(*, agent, task, validator, fn, anchor=True, run_id=None) -> RunOutcome
```

| Argument | Meaning |
|---|---|
| `agent` | An agent id (`agt_…`), a slug, or `{"slug": ..., "name": ..., "version": ..., "description": ..., "capabilities": [...]}`. A slug is created on first use. |
| `task` | `{"description": str, "parameters": {...}}`. `parameters` can be read by rules. |
| `validator` | An id (`"research-validator"`, `"custom:my-checker"`, `"custom:my-checker@2"`), **or** a dict `{"slug", "name", "rules", "description"?}`. |
| `fn` | `fn(run)` does the work and returns the result. `run.tool(name, input, fn)` records a `tool_call` before and a `tool_result` after (with the error if it raised); `run.record(type, content)` records evidence yourself (`tool_call`, `tool_result`, `model_output`, `artifact`; **never secrets**). |
| `anchor` | Publish a passing receipt on Arc. Default `True`. A server without a chain configured just skips it. |
| `run_id` | Makes the run idempotent: calling again with the same id after a crash **resumes** the same execution. |

`RunOutcome` fields: `result`, `status`, `checks`, `anchored`, `anchor`, `anchor_note` (why it is not anchored),
`execution_id`, `receipt_id`, `validator_id`, `validator_version`, `execution_url`, `proof_url`.

## Writing rules (validators)

Rules are plain data, stored on the server as **numbered, immutable versions** and evaluated there.

| `type` | Options | Passes when |
|---|---|---|
| `items` | `path`, `min`, `max` | The list at `path` has a length within the bounds. |
| `required_fields` | `path`, `fields` | Every matched object has each field present and non-empty. |
| `field_format` | `path`, `format` | Every matched value fits the format: `non_empty_string`, `http_url`, `email`, `iso_date`, `integer`, `number`, `boolean`, `non_empty_array`. |
| `number_range` | `path`, `min`, `max`, `integer` | Every matched value is a number within the bounds. |
| `one_of` | `path`, `values` | Every matched value is one of the listed values. |
| `unique` | `path` | No two matched values are equal. |
| `evidence` | `types`, `min` | Each listed evidence type was recorded at least `min` times (default 1). |
| `evidence_count` | `min`, `max` | The number of evidence records is within the bounds. |

Paths: `$` is the whole result, `$[*]` every element of a list, `$[*].url` a field of each element, `$[0]` one element. Any
bound can be a number or `{"param": "name", "default": 10}`, which reads `task.parameters.name`.

**Changing rules is safe.** The SDK sends the rules in your code on every run and the server reconciles them: a new slug
creates version 1, identical rules create nothing, changed rules create version N+1. Earlier versions and the verdicts they
produced never change. The SDK validates with the exact version it was given (`custom:startup-list@3`), so an older
deployment still running during a rollout keeps being judged by its own rules. Dry-run rules without storing anything with
`verid.validators.test(rules, result, evidence_types=..., task_parameters=...)`.

## Reliability and errors

- Network errors, timeouts, `429`, `502`, `503` and `504` are retried (default 3 times). Every logical call carries one
  idempotency key reused across its retries, so a retry can never create a duplicate.
- Resume after a crash by passing the same `run_id`.
- `VeridError` (any non-2xx answer) has `.status`, `.code` (`"invalid_request"`, `"unauthenticated"`, `"forbidden"`,
  `"not_found"`, `"conflict"`, `"rate_limited"`, `"unavailable"`, …), `.request_id` and `.validation_errors`.
  `VeridNetworkError` means Verid was unreachable on every attempt.
- If Arc is slow or down, the run is still validated and has a receipt; `out.anchor_note` says why. Call
  `verid.receipts.anchor(out.receipt_id)` later; repeating it is safe.

## Lower-level API

`verid.agents` (`create`, `ensure`, `list`, `get`, `update`, `delete`), `verid.validators` (`create`, `ensure`, `update`,
`list`, `test`), `verid.executions` (`create`, `start`, `add_evidence`, `complete`, `fail`, `get`), `verid.validations`
(`run`), `verid.receipts` (`create`, `anchor`, `proof_url`), and `verid.request(method, path, body)` for any other endpoint.

## Security

- **Keep the API key on the server side.** It authorises writes to your workspace; use one key per environment.
- **Do not record secrets or personal data as evidence.** Evidence content is stored by Verid and visible to members of your
  workspace; only hashes go on-chain.

## What a receipt proves, and what it does not

A receipt proves **integrity**: that this task, evidence and result were recorded, that these rules produced this verdict,
and that a fingerprint of it was published at a point in time that Verid cannot quietly alter. It does **not** prove the
agent's output is *true*: rules check structure and limits, and when you write the rules for your own agent a pass means
"this satisfied the rules its author chose".

Source and issues: https://github.com/nofazechris/verid · Licence: MIT
