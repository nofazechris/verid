#!/usr/bin/env node
/**
 * A REAL agent run, recorded by Verid. Nothing here is mocked.
 *
 * The "agent" finds popular GitHub repositories for a topic by calling GitHub's public search API. Every call it
 * makes and every answer it gets is sent to Verid as evidence; the final list is validated by a rule-based
 * validator that THIS SCRIPT defines; and, if the validation passes, the receipt is anchored on whatever chain
 * your Verid server is configured for.
 *
 *   VERID_URL=http://localhost:3000/api/v1 VERID_API_KEY=verid_xxxxxxxx_... node run.mjs [topic] [minimumResults]
 *   node run.mjs ai-agents 5
 *   node run.mjs rust-lang 8 --simulate-bad-result     # see a validation FAIL (and what Verid does with it)
 *
 * Needs Node 18+ (global fetch). No dependencies, no GitHub token (set GITHUB_TOKEN to lift the rate limit).
 */

const BASE = (process.env.VERID_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.VERID_API_KEY;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SIMULATE_BAD = process.argv.includes("--simulate-bad-result");
const TOPIC = args[0] ?? "ai-agents";
const MIN_RESULTS = Number(args[1] ?? 5);
const CREATED_AFTER_YEAR = 2023;

if (!BASE || !KEY) {
  console.error("Set VERID_URL (e.g. http://localhost:3000/api/v1) and VERID_API_KEY (Settings → API Keys in the dashboard).");
  process.exit(1);
}
const APP = BASE.replace(/\/api\/v1$/, "");

// ---------------------------------------------------------------------------------------------- Verid client
async function verid(method, path, body, idempotencyKey) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: "Bearer " + KEY,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${json?.error?.code ?? ""}: ${json?.error?.message ?? "request failed"}`);
    err.status = res.status;
    err.details = json?.error?.details;
    throw err;
  }
  return json;
}
const log = (m) => console.log(m);
const step = (n, m) => console.log(`\n${n}. ${m}`);

// ------------------------------------------------------------------------------ 1. the validator (rules as data)
// "What does a good result look like?" Written once, versioned by Verid, evaluated on Verid's server.
const VALIDATOR_ID = "github-repo-list";
const RULES = [
  { type: "items", path: "$", min: { param: "minimumResults", default: 3 } },
  { type: "required_fields", path: "$[*]", fields: ["name", "url", "stars", "createdAt", "createdYear"] },
  { type: "field_format", path: "$[*].url", format: "http_url" },
  { type: "field_format", path: "$[*].createdAt", format: "iso_date" },
  { type: "number_range", path: "$[*].stars", min: 0, integer: true },
  { type: "number_range", path: "$[*].createdYear", min: { param: "createdAfterYear" }, integer: true },
  { type: "unique", path: "$[*].url" },
  { type: "evidence", types: ["task", "tool_call", "tool_result", "result"] },
];

async function ensureValidator() {
  try {
    await verid("POST", "/validators", {
      slug: VALIDATOR_ID,
      name: "GitHub repository list checker",
      description: "A list of repositories, each with a name, URL, star count and creation date, with no duplicates.",
      rules: RULES,
    });
    log(`   created validator custom:${VALIDATOR_ID} (version 1)`);
  } catch (e) {
    if (e.status !== 409) throw e;
    log(`   validator custom:${VALIDATOR_ID} already exists, reusing it`);
  }
}

// -------------------------------------------------------------------------------------------- 2. the agent record
async function ensureAgent() {
  try {
    const { agent } = await verid("POST", "/agents", {
      slug: "github-researcher",
      name: "GitHub Researcher",
      version: "1.0.0",
      capabilities: ["http.fetch", "github.search"],
      description: "Finds popular GitHub repositories for a topic.",
    });
    return agent;
  } catch (e) {
    if (e.status !== 409) throw e;
    const { data } = await verid("GET", "/agents?limit=100");
    return data.find((a) => a.slug === "github-researcher");
  }
}

// ------------------------------------------------------------------------------------------------------- the run
async function main() {
  step(1, "Make sure the validator and the agent exist in Verid");
  await ensureValidator();
  const agent = await ensureAgent();
  log(`   agent ${agent.name} (${agent.id})`);

  // One run id drives every idempotency key, so a retry after a network error can never duplicate anything.
  const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const task = {
    description: `Find ${MIN_RESULTS} popular GitHub repositories for the topic "${TOPIC}" created in ${CREATED_AFTER_YEAR} or later.`,
    parameters: { topic: TOPIC, minimumResults: MIN_RESULTS, createdAfterYear: CREATED_AFTER_YEAR },
  };

  step(2, "Tell Verid a job is starting");
  const { execution } = await verid("POST", "/executions", { agentId: agent.id, task }, `exec-${run}`);
  await verid("POST", `/executions/${execution.id}/start`);
  await verid("POST", `/executions/${execution.id}/evidence`, { type: "task", content: task }, `${run}-task`);
  log(`   execution ${execution.id}`);

  step(3, "Do the real work, recording each call as evidence");
  const q = `topic:${TOPIC} created:>=${CREATED_AFTER_YEAR}-01-01`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${Math.max(MIN_RESULTS, 5)}`;
  const call = { tool: "github.search_repositories", method: "GET", url };
  await verid("POST", `/executions/${execution.id}/evidence`, { type: "tool_call", content: call }, `${run}-call`);

  const gh = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "verid-example",
      ...(process.env.GITHUB_TOKEN ? { authorization: "Bearer " + process.env.GITHUB_TOKEN } : {}),
    },
  });
  const body = await gh.json();
  if (!gh.ok) throw new Error(`GitHub said ${gh.status}: ${body.message ?? "error"} (unauthenticated search is limited to 10 requests/minute)`);
  // The evidence is what the tool actually returned (trimmed to fields we use, so it stays small).
  const hits = body.items.map((r) => ({ full_name: r.full_name, html_url: r.html_url, stargazers_count: r.stargazers_count, created_at: r.created_at }));
  await verid("POST", `/executions/${execution.id}/evidence`, { type: "tool_result", content: { status: gh.status, total_count: body.total_count, items: hits } }, `${run}-result`);
  log(`   GitHub returned ${hits.length} repositories (of ${body.total_count} matches)`);

  // The agent's answer, in the shape the validator expects.
  let result = hits.map((r) => ({
    name: r.full_name,
    url: r.html_url,
    stars: r.stargazers_count,
    createdAt: r.created_at,
    createdYear: new Date(r.created_at).getUTCFullYear(),
  }));
  if (SIMULATE_BAD) {
    result = result.map((r, i) => (i === 0 ? { ...r, url: "not-a-url" } : r)); // a deliberately broken entry
    log("   (--simulate-bad-result: the first entry now has an invalid URL)");
  }

  step(4, "Hand Verid the result and let it validate");
  await verid("POST", `/executions/${execution.id}/complete`, { result }, `${run}-done`);
  const { validation, executionStatus } = await verid("POST", "/validations", { executionId: execution.id, validatorId: `custom:${VALIDATOR_ID}` }, `${run}-validate`);
  log(`   outcome: ${validation.status.toUpperCase()}  (validator ${validation.validatorId} @ ${validation.validatorVersion})`);
  for (const c of validation.checks) log(`   ${c.determinate ? (c.ok ? "✓" : "✕") : "·"} ${c.description}${c.ok ? "" : `\n       ${c.explanation}`}`);

  step(5, "Create the receipt");
  const { receipt } = await verid("POST", "/receipts", { executionId: execution.id });
  log(`   receipt ${receipt.receiptId}`);

  if (validation.status !== "pass") {
    log(`\nThe validation did not pass, so this run is recorded as ${executionStatus} and can never be anchored or paid out.`);
    log("That is the point: the failure is preserved exactly as it happened. Run the script again for a new execution.");
    log(`See it: ${APP}/executions/${execution.id}`);
    return;
  }

  step(6, "Anchor the receipt's fingerprints on the chain");
  try {
    const anchored = await verid("POST", `/receipts/${receipt.receiptId}/anchor`);
    log(`   ${anchored.anchor.status}${anchored.anchor.transactionHash ? `  tx ${anchored.anchor.transactionHash}` : ""}`);
  } catch (e) {
    log(`   not anchored: ${e.message}`);
    log("   (Anchoring needs a chain configured on the server. The run is still validated and has a receipt.)");
  }

  log(`\nDone. Look at it:`);
  log(`  Dashboard : ${APP}/executions/${execution.id}`);
  log(`  Public proof (shareable, no login): ${APP}/proof/${receipt.receiptId}`);
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  if (e.details?.errors) for (const x of e.details.errors) console.error(`  - ${x}`);
  process.exit(1);
});
