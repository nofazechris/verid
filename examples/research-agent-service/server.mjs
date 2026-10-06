#!/usr/bin/env node
/**
 * The research agent as a small deployable web service (plus a one-shot CLI mode). No framework, no dependencies
 * except @verid/sdk.
 *
 *   node server.mjs                       start the service on $PORT (default 8787); open it in a browser
 *   node server.mjs --once "solid state batteries"     research one topic from the terminal and exit
 *
 *   POST /research   {"topic": "..."}  ->  { status, anchored, proofUrl, executionUrl, summary, findings, checks }
 *   GET  /health
 *
 * Environment:
 *   VERID_URL, VERID_API_KEY      required: your Verid server and an API key (Settings → API Keys)
 *   ANTHROPIC_API_KEY             optional: Claude writes the brief instead of the extractive fallback
 *   AGENT_ACCESS_TOKEN            optional but recommended when deployed publicly: callers must send
 *                                 "Authorization: Bearer <token>" (the web page asks for it)
 *   PORT                          default 8787
 */
import { createServer } from "node:http";
import { research, clientFromEnv } from "./agent.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.AGENT_ACCESS_TOKEN;

let verid;
try {
  verid = clientFromEnv();
} catch (e) {
  console.error(`\n${e.message}\nSet VERID_URL (for example http://localhost:3000) and VERID_API_KEY.\n`);
  process.exit(1);
}

// ------------------------------------------------------------------------------------------ one-shot mode
const onceAt = process.argv.indexOf("--once");
if (onceAt !== -1) {
  const topic = process.argv.slice(onceAt + 1).join(" ");
  if (!topic) {
    console.error('usage: node server.mjs --once "your topic"');
    process.exit(1);
  }
  try {
    const out = await research(verid, topic);
    printOutcome(out);
  } catch (e) {
    console.error(`\nThe run failed: ${e.message}\n(Verid recorded it as a failed execution; see the dashboard.)`);
    process.exit(1);
  }
  process.exit(0);
}

function printOutcome(out) {
  console.log(`\n${out.result.summary}\n`);
  console.log(`Findings (${out.result.findings.length}):`);
  for (const f of out.result.findings) console.log(`  - [${f.source}] ${f.title}\n      ${f.url}`);
  console.log(`\nVerid's verdict: ${out.status.toUpperCase()}  (${out.validatorId} @ ${out.validatorVersion})`);
  for (const c of out.checks) console.log(`  ${c.determinate ? (c.ok ? "✓" : "✕") : "·"} ${c.description}${c.ok ? "" : `\n      ${c.explanation}`}`);
  console.log(`\nAnchored on-chain: ${out.anchored ? "yes" : `no${out.anchorNote ? ` (${out.anchorNote})` : ""}`}`);
  console.log(`Dashboard:   ${out.executionUrl}`);
  console.log(`Public proof: ${out.proofUrl}\n`);
}

// ------------------------------------------------------------------------------------------- the service
// A tiny per-IP rate limit: each request spends real API calls and a Verid execution.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 6;
}

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Research agent (Verid)</title>
<style>
 body{font:15px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;background:#0b0d0c;color:#e8ece9}
 input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #303832;background:#101311;color:inherit}
 button{background:#e8ece9;color:#0b0d0c;cursor:pointer;border:0;font-weight:600}
 .row{display:flex;gap:8px;flex-wrap:wrap}.row input{flex:1;min-width:200px}
 pre{white-space:pre-wrap;background:#101311;border:1px solid #252b27;border-radius:10px;padding:14px}
 a{color:#4ade80}.ok{color:#4ade80}.bad{color:#d08a8a}.muted{color:#7c847f;font-size:13px}
</style>
<h1>Research agent</h1>
<p class="muted">Searches Wikipedia and Hacker News, writes a cited brief, and records the whole run in Verid so the result can be verified.</p>
<div class="row"><input id="t" placeholder="Topic, e.g. solid state batteries" maxlength="120">${TOKEN ? '<input id="k" type="password" placeholder="Access token">' : ""}<button id="go">Research</button></div>
<div id="out"></div>
<script>
const $=(i)=>document.getElementById(i);
async function go(){
  const out=$("out"); out.innerHTML="<p class='muted'>Researching and recording evidence… this takes ~10 seconds.</p>";
  try{
    const r=await fetch("/research",{method:"POST",headers:{"content-type":"application/json",...($("k")?{authorization:"Bearer "+$("k").value}:{})},body:JSON.stringify({topic:$("t").value})});
    const j=await r.json(); if(!r.ok) throw new Error(j.error||r.status);
    const esc=(s)=>String(s).replace(/[&<>]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
    out.innerHTML="<h2>Brief</h2><pre>"+esc(j.summary)+"</pre><h2>Sources</h2><ul>"+j.findings.map(f=>"<li><a href='"+esc(f.url)+"' target=_blank rel=noreferrer>"+esc(f.title)+"</a> <span class=muted>("+f.source+")</span></li>").join("")+"</ul>"
     +"<h2>Verid</h2><p>Verdict: <b class='"+(j.status==="pass"?"ok":"bad")+"'>"+j.status.toUpperCase()+"</b> · Anchored: <b>"+(j.anchored?"yes":"no")+"</b></p><p><a href='"+esc(j.proofUrl)+"' target=_blank>Public proof</a> · <a href='"+esc(j.executionUrl)+"' target=_blank>Run in dashboard</a></p>";
  }catch(e){out.innerHTML="<p class=bad>"+String(e.message).replace(/[<>]/g,"")+"</p>";}
}
$("go").onclick=go; $("t").onkeydown=(e)=>e.key==="Enter"&&go();
</script>`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE, "text/html; charset=utf-8");

    if (req.method === "POST" && url.pathname === "/research") {
      if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "missing or wrong access token" });
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress).split(",")[0].trim();
      if (limited(ip)) return send(res, 429, { error: "too many requests; wait a minute" });

      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4_000) return send(res, 413, { error: "request too large" });
      }
      let topic;
      try {
        topic = JSON.parse(raw || "{}").topic;
      } catch {
        return send(res, 400, { error: "body must be JSON like {\"topic\": \"...\"}" });
      }
      try {
        const out = await research(verid, topic);
        return send(res, 200, {
          status: out.status, anchored: out.anchored, anchorNote: out.anchorNote, summary: out.result.summary, findings: out.result.findings,
          checks: out.checks, executionUrl: out.executionUrl, proofUrl: out.proofUrl, receiptId: out.receiptId,
        });
      } catch (e) {
        // The run is already recorded by Verid as a failed execution (visible in the dashboard).
        return send(res, 502, { error: e.message });
      }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: "internal error" });
  }
}).listen(PORT, () => {
  console.log(`Research agent listening on http://localhost:${PORT}`);
  console.log(`Verid: ${verid.appUrl}${TOKEN ? "  (access token required)" : "  (WARNING: no AGENT_ACCESS_TOKEN set; do not expose publicly)"}`);
  console.log(`Brief writer: ${process.env.ANTHROPIC_API_KEY ? "Claude (ANTHROPIC_API_KEY set)" : "extractive (set ANTHROPIC_API_KEY to use Claude)"}`);
});
