"use client";

import { useEffect, useRef } from "react";
import { s } from "@/lib/style";
import { MONO } from "@/components/kit";
import type { CodeRef } from "@/lib/client/sample-agent";

/**
 * The code a developer writes for the tour's sample agent: the SDK's `verid.run`. The tour makes the same calls over
 * the same HTTP API from the browser, so each step of the live log lines up with a region of this code.
 * Lines are grouped; the group whose step is happening is highlighted.
 */
const LINES: [string, CodeRef | null][] = [
  ["const out = await verid.run(", null],
  ["  {", null],
  ['    agent: "github-researcher",', "task"],
  ["    task: {", "task"],
  ['      description: "Find 5 repos for ai-agents",', "task"],
  ["      parameters: { minimumResults: 5 },", "task"],
  ["    },", "task"],
  ["    validator: {              // the rules", "rules"],
  ['      slug: "github-repo-list",', "rules"],
  ["      rules: [", "rules"],
  ['        { type: "items", path: "$", min: 5 },', "rules"],
  ['        { type: "required_fields", path: "$[*]",', "rules"],
  ['          fields: ["name", "url", "stars"] },', "rules"],
  ['        { type: "unique", path: "$[*].url" },', "rules"],
  ['        { type: "evidence", types: ["tool_call"] },', "rules"],
  ["      ],", "rules"],
  ["    },", "rules"],
  ["  },", null],
  ["  async (run) => {            // your work", null],
  ['    const hits = await run.tool("github.search",', "work"],
  ['      { topic: "ai-agents" }, searchGitHub);', "work"],
  ["    return hits.map(toRepo);  // the result", "result"],
  ["  },", null],
  [");", null],
  ["", null],
  ['out.status;    // "pass" or "fail"', "verdict"],
  ["out.anchored;  // published on Arc?", "anchor"],
  ["out.proofUrl;  // link to share", "proof"],
];

const EXPLAIN: Record<CodeRef, { title: string; text: string }> = {
  task: { title: "The task", text: "What the agent was asked to do. Verid records it as the first piece of evidence, so the job itself can't be rewritten later." },
  rules: { title: "The rules", text: "Written by you, as data. Verid stores them as a numbered version in your workspace and applies them on its own server, never in your agent. Change them and push, and the next run makes version N+1." },
  work: { title: "Your work", text: "run.tool(...) records the call before it happens and the answer after, around your real code. This is the evidence trail. Here it calls GitHub's real API." },
  result: { title: "The result", text: "Whatever your function returns is sent to Verid and hashed. This is what the rules judge." },
  verdict: { title: "The verdict", text: "Decided by Verid's server, not your code. A failure is kept exactly as it happened and can never be anchored or paid out." },
  anchor: { title: "The anchor", text: "Only a passing run is published: a fingerprint of the receipt goes to Arc. No data goes on-chain, and Verid pays the gas." },
  proof: { title: "The proof link", text: "A public page anyone can open to recompute the fingerprints and check them against the chain." },
};

export default function TourCode({ active, running }: { active?: CodeRef; running: boolean }) {
  const dim = running && !!active;
  const info = active ? EXPLAIN[active] : undefined;
  const scroller = useRef<HTMLPreElement>(null);
  const firstOn = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Keep the active lines in view inside the code box (never scroll the modal or the page).
    const box = scroller.current;
    const line = firstOn.current;
    if (box && line) box.scrollTo({ top: Math.max(0, line.offsetTop - 48), behavior: "smooth" });
  }, [active]);
  firstOn.current = null; // set again below by the first highlighted line of this render
  let seen = false;
  return (
    <div style={s("display:flex;flex-direction:column;min-width:0;border:1px solid #1D221F;border-radius:10px;background:#0A0C0B;overflow:hidden")}>
      <div style={s("display:flex;align-items:center;height:32px;padding:0 14px;border-bottom:1px solid #161A18;background:#0F1210")}>
        <span style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:#7C847F`)}>THE CODE A DEVELOPER WRITES</span>
      </div>
      <div style={s("min-height:96px;padding:12px 14px;border-bottom:1px solid #161A18;background:#0F1210;display:flex;flex-direction:column;gap:4px")}>
        {info ? (
          <div key={active} style={s("animation:vdFade .25s ease;display:flex;flex-direction:column;gap:4px")}>
            <span style={s("font-size:13px;font-weight:500;color:#E8ECE9")}>{info.title}</span>
            <span style={s("font-size:12.5px;line-height:1.6;color:#9BA39E")}>{info.text}</span>
          </div>
        ) : (
          <span style={s("font-size:12.5px;line-height:1.6;color:#7C847F")}>Press <b style={{ fontWeight: 500, color: "#C8D0CB" }}>Run the agent</b>. Each step lights up the code that causes it, and this box explains it. (Simplified: a real agent has your own tools and rules.)</span>
        )}
      </div>
      <pre ref={scroller} style={s(`position:relative;margin:0;padding:10px 0;height:300px;overflow:auto;font-family:${MONO};font-size:11.8px;line-height:1.75;color:#C8D0CB`)} aria-label="Sample agent code">
        {LINES.map(([text, ref], i) => {
          const on = !!active && ref === active;
          const first = on && !seen;
          if (first) seen = true;
          return (
            <div
              key={i}
              ref={first ? firstOn : undefined}
              style={s(`padding:0 14px;min-height:20.6px;white-space:pre;border-left:2px solid ${on ? "#4ADE80" : "transparent"};background:${on ? "rgba(74,222,128,.09)" : "transparent"};opacity:${dim && !on ? 0.42 : 1};transition:opacity .25s ease,background .25s ease`)}
            >
              {text || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
