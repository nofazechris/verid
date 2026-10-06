# Research agent (recorded by Verid)

A real research agent. Give it a topic and it:

1. searches **Wikipedia** and reads the introductions of the best matches (public API, no key),
2. searches **Hacker News** for recent discussion (public API, no key),
3. writes a short brief that cites those sources: with **Claude** if `ANTHROPIC_API_KEY` is set (the model sees only
   the gathered sources), otherwise by quoting the sources.

Every call is wrapped in `run.tool(...)` from `@verid/sdk`, so Verid records exactly what was asked and what came back.
When the function returns, **Verid's server** validates the result against the rules in `agent.mjs` (a "cited research
brief"), and a passing run is anchored on Arc. The agent never decides whether it passed.

## Run it once

```bash
# from your Verid server (replace YOUR-HOST), in an empty folder:
curl -O https://YOUR-HOST/examples/research-agent/agent.mjs
curl -O https://YOUR-HOST/examples/research-agent/server.mjs
curl -O https://YOUR-HOST/examples/research-agent/package.json
curl -O https://YOUR-HOST/sdk/verid-sdk.tgz && npm install ./verid-sdk.tgz   # download, then install the FILE

VERID_URL=https://YOUR-HOST VERID_API_KEY=verid_xxxxxxxx_... node server.mjs --once "solid state batteries"
```

You get the brief, the sources, Verid's verdict for each rule, and two links (the run in your dashboard, and a public
proof page). Needs Node 18+.

## Run it as a web service

```bash
VERID_URL=https://YOUR-HOST VERID_API_KEY=verid_xxxxxxxx_... AGENT_ACCESS_TOKEN=pick-a-long-random-string \
  node server.mjs                      # then open http://localhost:8787

curl -X POST http://localhost:8787/research \
  -H "authorization: Bearer pick-a-long-random-string" -H "content-type: application/json" \
  -d '{"topic":"fusion power"}'
```

| Variable | Required | Meaning |
|---|---|---|
| `VERID_URL` | yes | Your Verid server (the deployed agent must be able to reach it) |
| `VERID_API_KEY` | yes | A developer key from Settings → API Keys |
| `AGENT_ACCESS_TOKEN` | strongly advised | Callers must send `Authorization: Bearer <token>`. **Set it before exposing the service.** |
| `ANTHROPIC_API_KEY` | no | Use Claude to write the brief |
| `PORT` | no | Default 8787 |

## Deploy

* **Any Node 18+ host:** copy the folder, `npm install ./verid-sdk.tgz`, `node server.mjs`.
* **Docker:** `docker build --build-arg VERID_SDK_URL=https://YOUR-HOST/sdk/verid-sdk.tgz -t research-agent .`
* **Render:** `render.yaml` is included (not tested by the Verid project; any Node host works).

Keep `VERID_API_KEY` and `ANTHROPIC_API_KEY` in your host's secret store, never in the repository. Each request does real
work (public API calls, a Verid execution, a chain transaction), so keep the access token on and the rate limit in place.

## What happens when it fails

If no sources are found, or a tool throws, the function throws and the SDK records the execution as **failed** with the
reason. It shows up in the agent's page under "Last failure" and lowers its health, instead of silently vanishing.

## What a pass does and does not mean

The validator checks the **shape**: a topic, a summary, enough distinct findings with valid URLs from known sources, and
that the tool calls were really recorded. It does **not** check that the facts are true or that the summary is good.
The result says so in two explicit checks.
