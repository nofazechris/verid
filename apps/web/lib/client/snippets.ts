/** Copy-paste code for connecting an agent, generated for THIS server and (optionally) a specific agent. */

export type Lang = "node" | "python" | "curl";

export interface Snippets {
  install: Record<"node" | "python", string>;
  code: Record<Lang, string>;
}

const EXAMPLE_RULES = `[
        { type: "items", path: "$", min: 1 },
        { type: "required_fields", path: "$[*]", fields: ["title", "url"] },
        { type: "field_format", path: "$[*].url", format: "http_url" },
        { type: "evidence", types: ["tool_call", "tool_result"] },
      ]`;

export function connectSnippets(origin: string, slug = "my-agent"): Snippets {
  const install = {
    node: `npm install verid`,
    python: `pip install verid        # one file, no dependencies`,
  };
  const node = `import { Verid } from "verid";

const verid = new Verid({ apiKey: process.env.VERID_API_KEY, baseUrl: "${origin}" });

const out = await verid.run(
  {
    agent: "${slug}", // created on first use if it does not exist
    task: { description: "Find 3 articles about solid state batteries" },
    validator: {
      // rules as data: what a good result looks like
      slug: "${slug}-checker",
      name: "${slug} checker",
      rules: ${EXAMPLE_RULES},
    },
  },
  async (run) => {
    // run.tool(...) records a tool_call before and a tool_result after, around your REAL call:
    const articles = await run.tool("search", { q: "solid state batteries" }, (input) => mySearch(input.q));
    return articles.map((a) => ({ title: a.title, url: a.url }));   // the result Verid will validate
  },
);

console.log(out.status, out.anchored, out.proofUrl);`;
  const python = `import os
from verid import Verid

verid = Verid(os.environ["VERID_API_KEY"], "${origin}")

def work(run):
    # run.tool(...) records a tool_call before and a tool_result after, around your REAL call:
    articles = run.tool("search", {"q": "solid state batteries"}, lambda i: my_search(i["q"]))
    return [{"title": a["title"], "url": a["url"]} for a in articles]   # the result Verid will validate

out = verid.run(
    agent="${slug}",  # created on first use if it does not exist
    task={"description": "Find 3 articles about solid state batteries"},
    validator={"slug": "${slug}-checker", "name": "${slug} checker", "rules": [
        {"type": "items", "path": "$", "min": 1},
        {"type": "required_fields", "path": "$[*]", "fields": ["title", "url"]},
        {"type": "field_format", "path": "$[*].url", "format": "http_url"},
        {"type": "evidence", "types": ["tool_call", "tool_result"]},
    ]},
    fn=work,
)
print(out.status, out.anchored, out.proof_url)`;
  const curl = `# The same lifecycle with plain HTTP (the SDK just does these calls for you):
H='-H "authorization: Bearer $VERID_API_KEY" -H "content-type: application/json"'
EXEC=$(curl -s -X POST ${origin}/api/v1/executions $H -d '{"agentId":"<agent id>","task":{"description":"Find 3 articles"}}' | jq -r .execution.id)
curl -s -X POST ${origin}/api/v1/executions/$EXEC/start $H
curl -s -X POST ${origin}/api/v1/executions/$EXEC/evidence $H -d '{"type":"tool_call","content":{"tool":"search","q":"..."}}'
curl -s -X POST ${origin}/api/v1/executions/$EXEC/complete $H -d '{"result":[{"title":"...","url":"https://..."}]}'
curl -s -X POST ${origin}/api/v1/validations $H -d "{\\"executionId\\":\\"$EXEC\\",\\"validatorId\\":\\"custom:${slug}-checker\\"}"`;
  return { install, code: { node, python, curl } };
}
