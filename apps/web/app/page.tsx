"use client";

import { useEffect, useState } from "react";
import { s } from "@/lib/style";
import { A } from "@/components/ui";
import { Logo, MONO } from "@/components/kit";
import ProofViz from "@/components/ProofViz";
import { ICON, nodeStyle, type NodeState } from "@/lib/client/graph";
import { useSession } from "@/lib/client/session";

const STAGES: [string, string, string][] = [
  ["TASK", "task", "defined"], ["AGENT", "agent", "identified"], ["EVIDENCE", "evidence", "committed"],
  ["VALIDATION", "validator", "checked"], ["RECEIPT", "result", "exported"], ["ARC", "arc", "anchored"],
];

const STEPS: [string, string, string][] = [
  ["01", "Instrument an agent", "Create an execution through the API and record tool calls, results and artifacts as the agent works."],
  ["02", "Capture evidence", "Each record is hashed and committed into an evidence root that also binds the record count and order."],
  ["03", "Validate the result", "A deterministic validator runs server-side over the recorded data. Failures are preserved, never overwritten."],
  ["04", "Generate a receipt", "A portable JSON receipt commits to the task, policy, evidence, result and validation outcome."],
  ["05", "Anchor on Arc", "The commitments are published through the VeridRegistry contract. Raw data never goes on-chain."],
  ["06", "Verify independently", "Recompute the hashes and read the chain yourself with the CLI. You never have to trust the dashboard."],
];

function Pipeline() {
  const [hs, setHs] = useState(0);
  useEffect(() => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setHs(STAGES.length + 1);
      return;
    }
    const t = setInterval(() => setHs((x) => (x >= STAGES.length + 4 ? 0 : x + 1)), 650);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={s("border:1px solid #252B27;border-radius:14px;background:#101311;overflow:hidden")}>
      <div style={s(`display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid #1D221F;font-family:${MONO};font-size:12px;color:#7C847F`)}>
        <span style={s("width:6px;height:6px;border-radius:50%;background:#6B736E")} />
        <span style={s("color:#9BA39E;letter-spacing:0.08em")}>EXECUTION LIFECYCLE</span>
        <span style={s("margin-left:auto;color:#6B736E")}>how a run flows through Verid (a diagram, not live data)</span>
      </div>
      <div style={s("padding:36px 32px;overflow-x:auto")}>
        <div style={s("position:relative;display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));min-width:700px")}>
          <div style={s("position:absolute;top:22px;left:calc(100% / 12);right:calc(100% / 12);height:1px;background:#252B27")}>
            <div style={s(`height:1px;width:${Math.min(Math.max(hs - 1, 0), 5) * 20}%;background:#2C8A66;transition:width .5s ease`)} />
          </div>
          {STAGES.map(([label, ic, sub], i) => {
            const st: NodeState = hs > i + 1 ? "done" : hs === i + 1 ? "run" : "idle";
            const v = nodeStyle(st, ic);
            return (
              <div key={label} style={s("position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center")}>
                <span style={s(`position:relative;width:44px;height:44px;border-radius:${v.rad};border:1px solid ${v.bd};background:${v.bg};color:${v.fg};display:grid;place-items:center;animation:${v.anim};transition:all .3s ease`)}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[ic]} /></svg>
                </span>
                <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.1em;color:${v.lc}`)}>{label}</span>
                <span style={s(`font-family:${MONO};font-size:11px;color:#6B736E`)}>{sub}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { status } = useSession();
  const authed = status === "authed";
  const featured = process.env.NEXT_PUBLIC_FEATURED_PROOF_ID;
  return (
    <div style={s("min-height:100vh;overflow-x:clip;background:radial-gradient(ellipse 70% 46% at 72% 4%,rgba(74,222,128,0.075),transparent 70%),radial-gradient(ellipse 50% 34% at 4% 62%,rgba(44,138,102,0.045),transparent 72%),radial-gradient(ellipse 60% 30% at 50% 100%,rgba(44,138,102,0.05),transparent 75%),#070908;color:#E8ECE9;font-size:14px;line-height:1.5;animation:apFade .4s ease both")}>
      <header className="vd-land-head" style={s("position:sticky;top:0;z-index:20;height:64px;display:flex;align-items:center;gap:40px;padding:0 40px;background:rgba(7,9,8,0.6);backdrop-filter:blur(14px);border-bottom:1px solid #1A1F1C")}>
        <A href="/" css="display:flex;align-items:center;color:#E8ECE9"><Logo size={18} /></A>
        <nav className="vd-land-nav" style={s("display:flex;gap:28px;font-size:14px")}>
          <A href="/#how" css="color:#9BA39E">How it works</A>
          <A href="/docs" css="color:#9BA39E">Documentation</A>
          <A href="/proof/verify" css="color:#9BA39E">Verify</A>
        </nav>
        <div style={s("margin-left:auto;display:flex;align-items:center;gap:12px")}>
          <A href="https://github.com" target="_blank" rel="noreferrer" css="color:#9BA39E;font-size:14px;padding:0 8px">GitHub</A>
          <A href={authed ? "/overview" : "/login"} css="display:inline-flex;align-items:center;height:34px;padding:0 14px;border-radius:8px;background:#E8ECE9;color:#0B0D0C;font-size:13.5px;font-weight:500;white-space:nowrap" hover="background:#FFFFFF;color:#0B0D0C">{authed ? "Open dashboard" : "Launch App"}</A>
        </div>
      </header>

      <section className="vd-land-sec" style={s("max-width:1440px;margin:0 auto;padding:104px 40px 48px")}>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));gap:56px;align-items:center")}>
          <div>
            <div style={s(`display:flex;align-items:center;gap:12px;margin-bottom:32px;font-family:${MONO};font-size:12px;letter-spacing:0.08em;color:#7C847F`)}>
              <span style={s("display:inline-flex;align-items:center;gap:8px;height:24px;padding:0 10px;border:1px solid #252B27;border-radius:999px;color:#9BA39E;white-space:nowrap")}><span style={s("width:6px;height:6px;border-radius:50%;background:#4ADE80")} />EXECUTION EVIDENCE LAYER</span>
              <span>OPEN SOURCE · ARC</span>
            </div>
            <h1 style={s("margin:0;font-size:clamp(46px,6.6vw,92px);line-height:0.98;letter-spacing:-0.045em;font-weight:600;max-width:1000px;text-wrap:balance")}>Make autonomous work verifiable.</h1>
            <p style={s("margin:28px 0 0;max-width:640px;font-size:19px;line-height:1.55;color:#9BA39E;text-wrap:pretty")}>Record agent execution evidence, validate outcomes, and anchor portable proofs on Arc.</p>
            <div style={s("display:flex;gap:12px;margin-top:40px;flex-wrap:wrap")}>
              <A href={authed ? "/overview" : "/signup"} css="display:inline-flex;align-items:center;height:44px;padding:0 20px;border-radius:9px;background:#E8ECE9;color:#0B0D0C;font-size:15px;font-weight:500;white-space:nowrap;transition:transform .15s ease, background .15s ease" hover="background:#FFFFFF;color:#0B0D0C;transform:scale(1.01)">Start building</A>
              <A href={featured ? `/proof/${featured}` : "/proof/verify"} css="display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 20px;border-radius:9px;border:1px solid #303832;color:#E8ECE9;font-size:15px;font-weight:500;white-space:nowrap;transition:background .15s ease, border-color .15s ease" hover="background:#151917;border-color:#3A443D;color:#E8ECE9">{featured ? "Explore a proof" : "Verify a receipt"}</A>
            </div>
          </div>
          <ProofViz />
        </div>
        <div style={s("margin-top:72px")}><Pipeline /></div>
      </section>

      <section className="vd-land-sec" style={s("max-width:1440px;margin:0 auto;padding:64px 40px 32px")}>
        <h2 style={s("margin:0 0 20px;font-size:clamp(32px,4vw,52px);line-height:1.02;letter-spacing:-0.035em;font-weight:600;max-width:820px")}>A log is not an independently verifiable record.</h2>
        <p style={s("margin:0;max-width:760px;font-size:17px;line-height:1.65;color:#9BA39E")}>
          A dashboard can show a green check without proving what was checked, and a log can be edited after the fact. Verid commits to what happened, makes the commitment public, and lets anyone recompute it, so “the agent did the work” becomes something a third party can check rather than something they have to believe.
        </p>
      </section>

      <section className="vd-land-sec" id="how" style={s("max-width:1440px;margin:0 auto;padding:64px 40px 32px")}>
        <div style={s(`margin-bottom:24px;font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:#7C847F`)}>HOW IT WORKS</div>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:16px")}>
          {STEPS.map(([n, t, d]) => (
            <div key={n} style={s("border:1px solid #252B27;border-radius:14px;background:#101311;padding:28px;display:flex;flex-direction:column;gap:12px")}>
              <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.1em;color:#4ADE80`)}>{n}</span>
              <h3 style={s("margin:0;font-size:20px;letter-spacing:-0.015em;font-weight:500")}>{t}</h3>
              <p style={s("margin:0;font-size:14px;line-height:1.6;color:#9BA39E")}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="vd-land-sec" style={s("max-width:1440px;margin:0 auto;padding:64px 40px 112px")}>
        <div style={s("border:1px solid #252B27;border-radius:14px;background:#101311;padding:48px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:48px;align-items:center")}>
          <div style={s("display:flex;flex-direction:column;gap:20px")}>
            <h2 style={s("margin:0;font-size:38px;letter-spacing:-0.03em;font-weight:600;line-height:1.05")}>Add proof to your agent.</h2>
            <p style={s("margin:0;color:#9BA39E;font-size:16px;max-width:460px;line-height:1.6")}>Drive the lifecycle over a plain REST API, then verify any receipt from the command line, without trusting us.</p>
            <div style={s("display:flex;gap:12px;flex-wrap:wrap")}>
              <A href="/docs/examples" css="display:inline-flex;align-items:center;height:40px;padding:0 18px;border-radius:8px;background:#E8ECE9;color:#0B0D0C;font-size:14px;font-weight:500" hover="background:#FFFFFF;color:#0B0D0C">Run a real example</A>
              <A href="/docs" css="display:inline-flex;align-items:center;height:40px;padding:0 18px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:14px;font-weight:500" hover="background:#151917;color:#E8ECE9">Read the docs</A>
              <A href="/proof/verify" css="display:inline-flex;align-items:center;height:40px;padding:0 18px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:14px;font-weight:500" hover="background:#151917;color:#E8ECE9">Verify a receipt</A>
            </div>
          </div>
          <pre style={s(`margin:0;padding:24px;border-radius:10px;background:#0B0D0C;border:1px solid #1D221F;font-family:${MONO};font-size:12.5px;line-height:1.8;color:#C8D0CB;overflow-x:auto`)}>
            <span style={{ color: "#7C847F" }}>{"# record, validate, anchor\n"}</span>
            {"curl -X POST $VERID/executions \\\n  -H \"authorization: Bearer $KEY\" -d '{...}'\n\n"}
            <span style={{ color: "#7C847F" }}>{"# verify independently, against the chain\n"}</span>
            {"verid receipt verify receipt.json \\\n  --bundle bundle.json \\\n  --rpc $ARC_RPC_URL --registry $REGISTRY"}
          </pre>
        </div>
      </section>

      <footer style={s("border-top:1px solid #1A1F1C")}>
        <div className="vd-land-sec" style={s("max-width:1440px;margin:0 auto;padding:48px 40px 64px;display:flex;gap:48px;flex-wrap:wrap;align-items:flex-start")}>
          <div style={s("display:flex;flex-direction:column;gap:8px;margin-right:auto")}>
            <Logo />
            <span style={s("color:#7C847F;font-size:13px")}>Make autonomous work verifiable.</span>
            <span style={s("color:#4D5450;font-size:12px;max-width:420px;line-height:1.55")}>Verid proves integrity, not truth: it shows what was committed and checked, and never claims an agent’s output is factually correct.</span>
          </div>
          <nav style={s("display:grid;grid-template-columns:repeat(3,auto);gap:12px 32px;font-size:13px")}>
            <A href="/docs" css="color:#9BA39E">Documentation</A>
            <A href="/docs/trust-model" css="color:#9BA39E">Trust model</A>
            <A href="/proof/verify" css="color:#9BA39E">Verify</A>
            <A href="/login" css="color:#9BA39E">Sign in</A>
            <A href="/signup" css="color:#9BA39E">Sign up</A>
            <A href="https://github.com" target="_blank" rel="noreferrer" css="color:#9BA39E">GitHub</A>
          </nav>
        </div>
      </footer>
    </div>
  );
}
