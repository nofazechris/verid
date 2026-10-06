# @verid/sdk

Record what an AI agent does, have the result **validated on a server**, and publish a **verifiable receipt on Arc**.
Zero dependencies. Node 18+, browsers and edge runtimes.

```bash
npm install ./verid-sdk.tgz          # from your Verid server: curl -O https://YOUR-HOST/sdk/verid-sdk.tgz
```

```ts
import { Verid } from "@verid/sdk";

const verid = Verid.fromEnv();        // VERID_API_KEY + VERID_URL

const out = await verid.run(
  {
    agent: "my-agent",                                   // created on first use
    task: { description: "Find 5 AI startups", parameters: { minimumResults: 5 } },
    validator: {                                         // rules as data; created on first use
      slug: "startup-list",
      name: "Startup list",
      rules: [
        { type: "items", path: "$", min: { param: "minimumResults" } },
        { type: "required_fields", path: "$[*]", fields: ["name", "url"] },
        { type: "evidence", types: ["tool_call", "tool_result"] },
      ],
    },
  },
  async (run) => {
    const hits = await run.tool("search", { q: "AI startups" }, (i) => mySearch(i.q)); // recorded as evidence
    return hits.map((h) => ({ name: h.title, url: h.url }));                            // the result to validate
  },
);

out.status;      // "pass" | "fail" | "inconclusive", decided by Verid's server, not your code
out.anchored;    // true once the receipt is confirmed on Arc
out.proofUrl;    // public, no-login proof page you can send to a customer
```

* If your function throws, the run is recorded as **failed** (with the reason) and the error is rethrown.
* A failed validation is preserved and can never be anchored or paid out.
* Pass the same `runId` to resume after a crash without creating a duplicate.
* Retries (network errors, 429, 502, 503, 504) reuse one idempotency key, so they can never duplicate anything.

Lower-level methods: `verid.agents`, `verid.validators`, `verid.executions`, `verid.validations`, `verid.receipts`,
`verid.settlements`. Full API reference: `/docs/api` on your Verid server.
