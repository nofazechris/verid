/**
 * A REAL research agent, instrumented with Verid.
 *
 * Given a topic it:
 *   1. searches Wikipedia and reads the introductions of the best matches   (public API, no key)
 *   2. searches Hacker News for recent discussion                           (public API, no key)
 *   3. writes a short brief that cites those sources:
 *        - with Claude, if ANTHROPIC_API_KEY is set (the model sees only the gathered sources)
 *        - otherwise extractively, by quoting the sources (no model, still real data)
 *
 * Every call is wrapped in `run.tool(...)`, so Verid records exactly what was asked and what came back. When the
 * function returns, Verid's SERVER validates the result against the rules below, and a passing run is anchored on
 * Arc. The agent never decides whether it passed.
 */
import { Verid } from "verid";

const UA = "verid-research-agent/0.1 (https://github.com/; contact: example)";

// ----------------------------------------------------------------------------------------- validator rules
// "What does a good research brief look like?" This is the contract between the agent and its customer.
export const VALIDATOR = {
  slug: "research-brief",
  name: "Cited research brief",
  description: "A brief with a topic, a summary, and several distinct, well-formed findings from known sources, backed by recorded tool calls.",
  rules: [
    { type: "required_fields", path: "$", fields: ["topic", "summary", "method", "findings"] },
    { type: "field_format", path: "$.summary", format: "non_empty_string" },
    { type: "one_of", path: "$.method", values: ["extractive", "llm"] },
    { type: "items", path: "$.findings", min: { param: "minimumFindings", default: 3 } },
    { type: "required_fields", path: "$.findings[*]", fields: ["title", "url", "source", "snippet"] },
    { type: "field_format", path: "$.findings[*].url", format: "http_url" },
    { type: "one_of", path: "$.findings[*].source", values: ["wikipedia", "hackernews"] },
    { type: "unique", path: "$.findings[*].url" },
    { type: "evidence", types: ["tool_call", "tool_result"] },
  ],
};

// ----------------------------------------------------------------------------------------------- the tools
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.json();
}

/** Wikipedia: search, then fetch the plain-text introduction of each hit. Returns clean findings. */
async function wikipedia({ topic, limit }) {
  const search = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=${limit}&format=json&origin=*`,
  );
  const titles = (search.query?.search ?? []).map((h) => h.title);
  if (!titles.length) return [];
  const extracts = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=${titles.length}&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`,
  );
  const pages = Object.values(extracts.query?.pages ?? {});
  return titles
    .map((title) => pages.find((p) => p.title === title))
    .filter((p) => p?.extract)
    .map((p) => ({
      title: p.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      source: "wikipedia",
      snippet: p.extract.replace(/\s+/g, " ").trim().slice(0, 400),
    }));
}

/** Hacker News (Algolia): recent stories about the topic. */
async function hackerNews({ topic, limit }) {
  const r = await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=${limit}`);
  return (r.hits ?? [])
    .filter((h) => h.title && (h.url || h.objectID))
    .map((h) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "hackernews",
      snippet: `${h.points ?? 0} points, ${h.num_comments ?? 0} comments on Hacker News (${String(h.created_at ?? "").slice(0, 10)}).`,
    }));
}

/** Optional: Claude writes the brief from the gathered sources ONLY. */
async function claudeBrief({ topic, findings }) {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const sources = findings.map((f, i) => `[${i + 1}] ${f.title} (${f.source}) ${f.url}\n${f.snippet}`).join("\n\n");
  const prompt =
    `Write a brief (120 to 180 words) about "${topic}" using ONLY the numbered sources below. ` +
    `Cite sources inline as [1], [2]. Do not add facts that are not in the sources. If the sources disagree or are thin, say so.\n\n${sources}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Anthropic answered ${res.status}: ${body?.error?.message ?? "error"}`);
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  if (!text) throw new Error("Anthropic returned no text");
  return { model, text };
}

/** Extractive brief: no model, just the sources, quoted and numbered. Honest about what it is. */
function extractiveBrief({ topic, findings }) {
  const lines = findings.slice(0, 5).map((f, i) => `[${i + 1}] ${f.title}: ${f.snippet.split(/(?<=[.!?])\s/)[0]}`);
  return `Sources found for "${topic}". ${lines.join(" ")}`;
}

// -------------------------------------------------------------------------------------------- the agent
/**
 * Research one topic, as a Verid-recorded run. Returns Verid's outcome (status, anchored, proofUrl, checks) with the
 * brief in `outcome.result`.
 */
export async function research(verid, topic, { minimumFindings = 3, sourcesPerTool = 4 } = {}) {
  const clean = String(topic ?? "").trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 120) throw new Error("topic must be between 2 and 120 characters");

  return verid.run(
    {
      agent: { slug: "research-agent", name: "Research Agent", version: "1.0.0", capabilities: ["wikipedia.search", "hackernews.search", process.env.ANTHROPIC_API_KEY ? "claude.summarise" : "extractive.summarise"], description: "Searches public sources and writes a cited brief." },
      task: { description: `Research "${clean}" and write a cited brief from public sources.`, parameters: { topic: clean, minimumFindings, sources: ["wikipedia", "hackernews"] } },
      validator: VALIDATOR,
    },
    async (run) => {
      // 1 & 2: gather. Independent tools run in parallel; each is recorded as its own tool_call / tool_result.
      const [wiki, hn] = await Promise.allSettled([
        run.tool("wikipedia.search_and_extract", { topic: clean, limit: sourcesPerTool }, wikipedia),
        run.tool("hackernews.search", { topic: clean, limit: sourcesPerTool }, hackerNews),
      ]);
      const findings = [...(wiki.status === "fulfilled" ? wiki.value : []), ...(hn.status === "fulfilled" ? hn.value : [])];
      const seen = new Set();
      const unique = findings.filter((f) => !seen.has(f.url) && seen.add(f.url));
      if (!unique.length) throw new Error(`no sources found for "${clean}" (wikipedia: ${wiki.status}, hackernews: ${hn.status})`);

      // 3: write the brief.
      let summary;
      let method;
      if (process.env.ANTHROPIC_API_KEY) {
        const out = await run.tool("anthropic.messages", { topic: clean, sources: unique.length }, () => claudeBrief({ topic: clean, findings: unique }));
        await run.record("model_output", { model: out.model, text: out.text });
        summary = out.text;
        method = "llm";
      } else {
        summary = extractiveBrief({ topic: clean, findings: unique });
        method = "extractive";
      }
      return { topic: clean, method, summary, findings: unique };
    },
  );
}

export const clientFromEnv = () => Verid.fromEnv();
