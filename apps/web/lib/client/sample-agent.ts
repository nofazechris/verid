"use client";

import { ApiClientError, errorMessage, get, post } from "./api";

/**
 * The guided tour's sample agent. It does REAL work: it calls GitHub's public search API from the browser, records
 * every call and answer as evidence in the signed-in workspace, hands Verid the result, lets Verid validate it, and
 * asks for a receipt and an anchor. It talks to the same HTTP API that any agent uses (here with the dashboard
 * session instead of an API key), so what you see is exactly what a connected agent produces.
 *
 * It mirrors examples/github-research/run.mjs.
 */

/** Positions in the flow diagram: 0 agent, 1 SDK, 2 server, 3 Arc, 4 proof link. */
export type SampleStage = 0 | 1 | 2 | 3 | 4;

/** The part of the developer's `verid.run(...)` code an event corresponds to; the tour highlights it. */
export type CodeRef = "task" | "rules" | "work" | "result" | "verdict" | "anchor" | "proof";

export interface SampleEvent {
  stage: SampleStage;
  code: CodeRef;
  message: string;
  kind: "info" | "ok" | "bad";
}

export interface SampleCheck {
  description: string;
  ok: boolean;
  determinate: boolean;
  explanation?: string;
}

export interface SampleOutcome {
  executionId: string;
  receiptId?: string;
  passed: boolean;
  validatorLabel: string;
  checks: SampleCheck[];
  repos: { name: string; url: string; stars: number }[];
  anchor?: { status: string; transactionHash?: string };
  /** Why nothing was anchored, when that is the case (no chain configured, or the validation failed). */
  anchorNote?: string;
  /** Set when the agent itself crashed (for example GitHub's rate limit); the run is recorded as failed. */
  crashed?: string;
}

const VALIDATOR_SLUG = "github-repo-list";
const AGENT_SLUG = "tour-github-researcher";
const CREATED_AFTER_YEAR = 2023;

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

/** The rules, exported so the tour can show the developer what "a good result" means here. */
export const SAMPLE_RULES_SUMMARY = [
  "at least the requested number of repositories",
  "every item has a name, url, stars and creation date",
  "urls are real http(s) urls, dates are ISO dates",
  "no duplicates, nothing created before 2023",
  "the run recorded a task, a tool call, a tool result and a result",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Makes the server's validator match RULES above (creates a new version only if they changed) and returns the pinned id. */
async function ensureValidator(): Promise<string> {
  const { validator } = await post("/validators/ensure", {
    slug: VALIDATOR_SLUG,
    name: "GitHub repository list checker",
    description: "A list of repositories, each with a name, URL, star count and creation date, with no duplicates.",
    rules: RULES,
  });
  return `custom:${VALIDATOR_SLUG}@${validator.version}`;
}

async function ensureAgent(): Promise<{ id: string }> {
  try {
    const { agent } = await post("/agents", {
      slug: AGENT_SLUG,
      name: "Tour: GitHub researcher",
      version: "1.0.0",
      capabilities: ["http.fetch", "github.search"],
      description: "The guided tour's sample agent. Finds popular GitHub repositories for a topic.",
    });
    return agent;
  } catch (e) {
    if (!(e instanceof ApiClientError) || e.status !== 409) throw e;
    const { data } = await get("/agents?limit=100");
    const found = (data as { slug: string; id: string }[]).find((a) => a.slug === AGENT_SLUG);
    if (!found) throw e;
    return found;
  }
}

export async function runSampleAgent(opts: {
  topic: string;
  minimum: number;
  /** Hand Verid a deliberately broken result so the tour can show a validation failure. */
  broken?: boolean;
  onEvent: (e: SampleEvent) => void;
}): Promise<SampleOutcome> {
  const { topic, minimum, broken, onEvent } = opts;
  // A short beat after each step so a person can follow the highlighted code; the network calls are the real timing.
  const say = async (stage: SampleStage, code: CodeRef, message: string, kind: SampleEvent["kind"] = "info") => {
    onEvent({ stage, code, message, kind });
    await sleep(300);
  };

  await say(0, "rules", "Registering the agent and its validator in your workspace");
  const validatorId = await ensureValidator();
  const agent = await ensureAgent();

  const task = {
    description: `Find ${minimum} popular GitHub repositories for the topic "${topic}" created in ${CREATED_AFTER_YEAR} or later.`,
    parameters: { topic, minimumResults: minimum, createdAfterYear: CREATED_AFTER_YEAR },
  };
  const { execution } = await post("/executions", { agentId: agent.id, task });
  const id: string = execution.id;
  await post(`/executions/${id}/start`);
  await say(1, "task", "Told Verid a job is starting, and recorded the task as evidence");
  await post(`/executions/${id}/evidence`, { type: "task", content: task });

  // ------------------------------------------------------------------ the real work (a real network call)
  const q = `topic:${topic} created:>=${CREATED_AFTER_YEAR}-01-01`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${Math.max(minimum, 5)}`;
  await say(0, "work", `Calling GitHub: search repositories for topic "${topic}"`);
  await post(`/executions/${id}/evidence`, { type: "tool_call", content: { tool: "github.search_repositories", method: "GET", url } });
  await sleep(250);

  let hits: { full_name: string; html_url: string; stargazers_count: number; created_at: string }[];
  let total = 0;
  try {
    const res = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
    const body = await res.json();
    if (!res.ok) throw new Error(`GitHub said ${res.status}: ${body?.message ?? "error"} (unauthenticated search is limited to 10 requests per minute)`);
    total = body.total_count ?? 0;
    hits = (body.items ?? []).map((r: any) => ({ full_name: r.full_name, html_url: r.html_url, stargazers_count: r.stargazers_count, created_at: r.created_at }));
    await say(0, "work", `GitHub answered: ${hits.length} repositories (of ${total.toLocaleString()} matches)`, "ok");
    await post(`/executions/${id}/evidence`, { type: "tool_result", content: { status: res.status, total_count: total, items: hits } });
  } catch (e) {
    // The agent crashed. Verid keeps that: the run shows as failed with the reason instead of vanishing.
    const reason = errorMessage(e);
    await say(1, "work", `The agent crashed: ${reason}`, "bad");
    await post(`/executions/${id}/fail`, { reason: reason.slice(0, 480) }).catch(() => undefined);
    return { executionId: id, passed: false, validatorLabel: `custom:${VALIDATOR_SLUG}`, checks: [], repos: [], crashed: reason };
  }
  await say(1, "work", "Recorded GitHub's answer as evidence", "ok");

  let result = hits.map((r) => ({
    name: r.full_name,
    url: r.html_url,
    stars: r.stargazers_count,
    createdAt: r.created_at,
    createdYear: new Date(r.created_at).getUTCFullYear(),
  }));
  if (broken && result.length) {
    result = result.map((r, i) => (i === 0 ? { ...r, url: "not-a-url" } : r));
    await say(0, "result", "On purpose: the first repository's link is now not-a-url", "bad");
  }
  const repos = result.map((r) => ({ name: r.name, url: r.url, stars: r.stars }));

  // ----------------------------------------------------------------------------- Verid validates, on its server
  await say(2, "result", "Handed Verid the result. Its server now checks it against the rules");
  await post(`/executions/${id}/complete`, { result });
  const { validation } = await post("/validations", { executionId: id, validatorId });
  const passed = validation.status === "pass";
  const checks: SampleCheck[] = (validation.checks ?? []).map((c: any) => ({
    description: c.description, ok: !!c.ok, determinate: c.determinate !== false, explanation: c.ok ? undefined : c.explanation,
  }));
  await say(2, "verdict", passed ? "Verdict: PASS. Every rule held" : "Verdict: FAIL. A rule did not hold", passed ? "ok" : "bad");

  const { receipt } = await post("/receipts", { executionId: id });
  const base = { executionId: id, receiptId: receipt.receiptId as string, passed, validatorLabel: `custom:${VALIDATOR_SLUG}`, checks, repos };
  if (!passed) {
    await say(2, "verdict", "Not anchored, and it never can be: only a passing run can be", "bad");
    return { ...base, anchorNote: "The validation failed, so this run can never be anchored or paid out. The failure is kept exactly as it happened." };
  }
  await say(2, "verdict", "Receipt created: fingerprints of the task, evidence, result and verdict", "ok");

  // --------------------------------------------------------------------------------------------------- the anchor
  await say(3, "anchor", "Publishing the receipt's fingerprints on Arc (this can take a few seconds)");
  try {
    const anchored = await post(`/receipts/${receipt.receiptId}/anchor`);
    const a = anchored.anchor as { status: string; transactionHash?: string };
    await say(3, "anchor", a.transactionHash ? `Anchored on Arc, transaction ${a.transactionHash.slice(0, 10)}…` : `Anchor ${a.status}`, "ok");
    await say(4, "proof", "Your shareable proof link is ready", "ok");
    return { ...base, anchor: { status: a.status, transactionHash: a.transactionHash } };
  } catch (e) {
    const unconfigured = e instanceof ApiClientError && e.code === "unavailable";
    await say(3, "anchor", unconfigured ? "This server has no chain configured, so nothing was anchored" : `Anchoring did not finish: ${errorMessage(e)}`, unconfigured ? "info" : "bad");
    await say(4, "proof", "The proof link works anyway: it just shows no chain record", "info");
    return {
      ...base,
      anchorNote: unconfigured
        ? "This server has no Arc network configured, so the run is validated and has a receipt but is not anchored."
        : `Anchoring did not finish (${errorMessage(e)}). The run is validated and has a receipt; anchoring can be retried from the run page.`,
    };
  }
}
