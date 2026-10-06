"use client";

import { useState, type ReactNode } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import ConnectAgent from "@/components/ConnectAgent";
import { Card, ErrorBox, Label, Loading, Mono, Page, PageTitle, Spinner, ghostBtn, ghostHover, MONO } from "@/components/kit";
import { ago, executionBadge, short } from "@/lib/client/format";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

/** The one picture that explains the product. */
function Flow() {
  const box = (x: number, w: number, title: string, sub: string, accent = false) => (
    <g key={title}>
      <rect x={x} y={14} width={w} height={74} rx={10} fill={accent ? "#0F1512" : "#101311"} stroke={accent ? "#2C8A66" : "#252B27"} />
      <text x={x + w / 2} y={44} textAnchor="middle" fontSize="13" fontWeight="500" fill="#E8ECE9" fontFamily="Geist, sans-serif">{title}</text>
      <text x={x + w / 2} y={64} textAnchor="middle" fontSize="10.5" fill="#7C847F" fontFamily="'Geist Mono',monospace">{sub}</text>
    </g>
  );
  const arrow = (x: number) => <path key={x} d={`M${x} 51 h18 m-6 -5 l6 5 l-6 5`} stroke="#3A443D" fill="none" strokeWidth="1.5" />;
  return (
    <svg viewBox="0 0 760 108" width="100%" role="img" aria-label="Your agent reports to Verid, which validates the result and anchors a receipt on Arc, producing a proof link" style={{ display: "block", minWidth: 560 }}>
      {box(0, 150, "Your agent", "any code, any model")}
      {arrow(152)}
      {box(172, 150, "Verid SDK", "records each step")}
      {arrow(324)}
      {box(344, 170, "Verid server", "validates the result", true)}
      {arrow(516)}
      {box(536, 108, "Arc chain", "fingerprint only")}
      {arrow(646)}
      {box(666, 94, "Proof link", "shareable")}
    </svg>
  );
}

function Step({ n, title, done, current, optional, children, summary }: { n: number; title: string; done: boolean; current: boolean; optional?: boolean; children: ReactNode; summary?: ReactNode }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? current;
  return (
    <div style={s(`border:1px solid ${current ? "#2C8A66" : "#252B27"};border-radius:12px;background:${current ? "#0F1512" : "#101311"};overflow:hidden`)}>
      <Btn onClick={() => setOpen(!isOpen)} css="width:100%;display:flex;align-items:center;gap:14px;padding:16px 20px;background:transparent;border:0;color:inherit;cursor:pointer;text-align:left" hover="background:rgba(255,255,255,0.02)">
        <span style={s(`flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-family:${MONO};font-size:12px;border:1px solid ${done ? "#2C8A66" : current ? "#4ADE80" : "#303832"};background:${done ? "#10241A" : "transparent"};color:${done ? "#4ADE80" : current ? "#4ADE80" : "#7C847F"}`)}>{done ? "✓" : n}</span>
        <span style={s("display:flex;flex-direction:column;gap:2px;min-width:0")}>
          <span style={s("font-size:15.5px;font-weight:500")}>{title}{optional && <span style={s(`margin-left:10px;font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:#7C847F`)}>OPTIONAL</span>}</span>
          {!isOpen && summary && <span style={s("font-size:12.5px;color:#7C847F")}>{summary}</span>}
        </span>
        <span style={s("margin-left:auto;color:#7C847F;font-size:13px")}>{isOpen ? "Hide" : "Show"}</span>
      </Btn>
      {isOpen && <div style={s("padding:4px 20px 22px 60px;display:flex;flex-direction:column;gap:14px")}>{children}</div>}
    </div>
  );
}

const P = ({ children }: { children: ReactNode }) => <p style={s("margin:0;font-size:13.5px;line-height:1.65;color:#9BA39E;max-width:720px")}>{children}</p>;
const Term = ({ k, children }: { k: string; children: ReactNode }) => (
  <div style={s("display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid #1D221F;border-radius:10px;background:#0F1210")}>
    <span style={s("font-size:13.5px;font-weight:500")}>{k}</span>
    <span style={s("font-size:12.5px;line-height:1.6;color:#9BA39E")}>{children}</span>
  </div>
);

export default function GetStarted() {
  const { toast } = useSession();
  const ob = useApi<any>("/onboarding", { pollMs: 4000 });
  const [path, setPath] = useState<"research" | "own">("research");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-verid-host";

  if (ob.loading && !ob.data) return <Page><PageTitle title="Get started" /><Loading /></Page>;
  if (ob.error && !ob.data) return <Page><PageTitle title="Get started" /><ErrorBox error={ob.error} retry={ob.reload} /></Page>;
  const d = ob.data!;

  const done = [d.apiKeys > 0, d.executions > 0, d.customValidators > 0 || d.passed > 0, d.passed > 0, d.escrows > 0];
  const core = done.slice(0, 4);
  const doneCount = core.filter(Boolean).length;
  const currentIdx = core.findIndex((x) => !x);
  const copy = (t: string) => {
    void navigator.clipboard?.writeText(t);
    toast("Copied");
  };

  const researchCmd = `# 1. Get the agent (three small files) and the SDK from this server
mkdir research-agent && cd research-agent
curl -O ${origin}/examples/research-agent/agent.mjs
curl -O ${origin}/examples/research-agent/server.mjs
curl -O ${origin}/examples/research-agent/package.json
curl -O ${origin}/sdk/verid-sdk.tgz && npm install ./verid-sdk.tgz

# 2. Run it once on a real topic (needs Node 18+)
VERID_URL=${origin} VERID_API_KEY=<your key> node server.mjs --once "solid state batteries"`;

  return (
    <Page>
      <PageTitle title="Get started" sub="From zero to a real agent reporting to Verid, with a proof link you can send to someone. Each step ticks itself when it actually happens." />

      <Card pad={22} gap={12}>
        <div style={s("display:flex;align-items:center;gap:14px;flex-wrap:wrap")}>
          <Label>YOUR PROGRESS</Label>
          <span style={s(`font-family:${MONO};font-size:12px;color:${doneCount === 4 ? "#4ADE80" : "#9BA39E"}`)}>{doneCount} of 4 core steps</span>
          <div style={s("flex:1;min-width:140px;height:4px;border-radius:2px;background:#1D221F;overflow:hidden")}><div style={s(`height:4px;width:${(doneCount / 4) * 100}%;background:#2C8A66;transition:width .4s ease`)} /></div>
        </div>
        {doneCount === 4 && <span style={s("font-size:13.5px;color:#4ADE80")}>You have a real, validated run{d.anchored > 0 ? " anchored on Arc" : ""}. The steps below are for going further.</span>}
      </Card>

      <div style={{ overflowX: "auto" }}><Flow /></div>

      <Card gap={14} pad={22}>
        <Label>THE THREE WORDS YOU WILL SEE</Label>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px")}>
          <Term k="Agent">A name for a piece of your software that does work (a script, a service, an LLM loop). It does not run inside Verid; it runs wherever you run it, and reports in.</Term>
          <Term k="Validator">Rules that say what a good result looks like. Verid runs them on <b style={{ color: "#C8D0CB", fontWeight: 500 }}>its</b> server, so your agent cannot mark its own homework.</Term>
          <Term k="Receipt and anchor">A small record of fingerprints (hashes) of the task, evidence, result and verdict, published on Arc. It contains none of your data, and anyone can check it later.</Term>
        </div>
      </Card>

      <div style={s("display:flex;flex-direction:column;gap:12px")}>
        <Step n={1} title="Create an API key" done={done[0]!} current={currentIdx === 0} summary="A key exists. Your code uses it to report to this workspace.">
          <P>The key is how your code proves it may report to this workspace. It is shown once, so copy it somewhere safe (an environment variable or your host’s secret manager). Keep it on the server side, never in a browser.</P>
          <div><A href="/settings/keys" css="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;background:#E8ECE9;color:#0B0D0C;font-size:13px;font-weight:500">Create an API key</A></div>
        </Step>

        <Step n={2} title="Make an agent report a real run" done={done[1]!} current={currentIdx === 1} summary={d.latestExecution ? `Latest run ${short(d.latestExecution.id, 10, 4)}, ${ago(d.latestExecution.createdAt)}.` : undefined}>
          <P>Pick the fastest way to see something real. Both paths record real work, validate it on the server, and (if this server has a chain configured) anchor it on Arc.</P>
          <div style={s("display:flex;gap:8px;flex-wrap:wrap")}>
            {([["research", "Run our research agent (no code to write)"], ["own", "Connect my own agent"]] as const).map(([k, label]) => (
              <Btn key={k} onClick={() => setPath(k)} css={`height:34px;padding:0 14px;border-radius:8px;border:1px solid ${path === k ? "#3A443D" : "#252B27"};background:${path === k ? "#151917" : "transparent"};color:${path === k ? "#E8ECE9" : "#9BA39E"};font-size:13px;cursor:pointer`} hover="background:#151917;color:#E8ECE9">{label}</Btn>
            ))}
          </div>
          {path === "research" ? (
            <>
              <P>
                A real research agent: it searches Wikipedia and Hacker News for a topic and writes a cited brief. Every search is recorded as evidence. With an <Mono size={12.5}>ANTHROPIC_API_KEY</Mono> set it uses Claude to write the brief; without one it quotes the sources. It is also a small web service you can deploy (see the <A href="/docs/examples" css="color:#4ADE80">examples</A>).
              </P>
              <div style={s("border:1px solid #1D221F;border-radius:10px;background:#0A0C0B;overflow:hidden")}>
                <div style={s("display:flex;align-items:center;height:32px;padding:0 10px 0 14px;border-bottom:1px solid #161A18;background:#0F1210")}>
                  <span style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:#7C847F`)}>TERMINAL</span>
                  <Btn onClick={() => copy(researchCmd)} css="margin-left:auto;height:22px;padding:0 8px;border-radius:5px;border:1px solid #252B27;background:transparent;color:#9BA39E;font-size:11.5px;cursor:pointer" hover="color:#E8ECE9;border-color:#303832">Copy</Btn>
                </div>
                <pre style={s(`margin:0;padding:12px 14px;overflow-x:auto;font-family:${MONO};font-size:12.2px;line-height:1.7;color:#C8D0CB`)}>{researchCmd}</pre>
              </div>
            </>
          ) : (
            <ConnectAgent slug="my-agent" />
          )}
          <div style={s("display:flex;align-items:center;gap:10px;font-size:13px;color:#9BA39E")}>
            {d.executions > 0 ? <><span style={{ color: "#4ADE80" }}>✓</span> A run arrived.</> : <><Spinner size={12} /> Waiting for your first run. This page updates by itself.</>}
          </div>
        </Step>

        <Step n={3} title="Say what a good result looks like (a validator)" done={done[2]!} current={currentIdx === 2} summary={d.customValidators ? `${d.customValidators} workspace validator${d.customValidators === 1 ? "" : "s"} defined.` : "Optional while you try things out: the research agent defines its own."}>
          <P>
            A validator is a short list of rules: how many items, which fields, which formats, which evidence must exist. Verid applies them on its server and records the verdict. The SDK creates the validator for you the first time a run uses it, or you can build one here with a template and test it on a sample before saving.
          </P>
          <div><A href="/validators" css="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:13px">Open validators and templates</A></div>
        </Step>

        <Step n={4} title="Watch it land, then verify it without trusting us" done={done[3]!} current={currentIdx === 3} summary={d.passed ? `${d.passed} run${d.passed === 1 ? "" : "s"} passed${d.anchored ? `, ${d.anchored} anchored on Arc` : ""}.` : undefined}>
          {d.latestExecution ? (
            <>
              <div style={s("display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;border:1px solid #252B27;border-radius:10px;background:#0F1210")}>
                <Mono>{short(d.latestExecution.id, 12, 4)}</Mono>
                <span style={s(`font-family:${MONO};font-size:12px;color:${executionBadge(d.latestExecution.status).fg}`)}>{executionBadge(d.latestExecution.status).label}</span>
                <A href={`/executions/${d.latestExecution.id}`} css="margin-left:auto;color:#4ADE80;font-size:13px">Inspect the run →</A>
              </div>
              <P>On the run page you see each stage drawn from real records: the task, every tool call (the evidence), the validator’s verdict with each check, the receipt, and the Arc anchor. Press <b style={{ color: "#C8D0CB", fontWeight: 500 }}>Verify now</b> on the receipt to recompute everything and read the chain, or give anyone the public proof link.</P>
              {!d.chainConfigured && <P><b style={{ color: "#CDB274", fontWeight: 500 }}>This server has no chain configured</b>, so runs are validated and get receipts but are not anchored. See <A href="/docs/deploy-arc" css="color:#4ADE80">Deploy to Arc</A>.</P>}
            </>
          ) : <P>Once your agent reports a run, it appears here with a link to everything it recorded.</P>}
        </Step>

        <Step n={5} title="Get paid only when it is proven (escrow)" done={done[4]!} current={false} optional summary="A customer locks USDC that releases only after a validation Pass and an anchor.">
          <P>If someone is paying for the work, they can lock USDC for the run in an escrow contract. It pays out only when the validator recorded a Pass and the receipt is anchored; otherwise it returns to them. Fund and settle from the run page.</P>
          <div style={s("display:flex;gap:10px;flex-wrap:wrap")}>
            <A href="/settlements" css="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:13px">Settlements</A>
            <A href="/docs/escrow" css="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:13px">How escrow works</A>
          </div>
          {!d.escrowConfigured && <P><b style={{ color: "#CDB274", fontWeight: 500 }}>No escrow contract is configured on this server.</b> Nothing can be funded until it is.</P>}
        </Step>

        <Step n={6} title="Keep an eye on it" done={false} current={false} optional summary="Health, pass rate and failures for every agent.">
          <P>Open <A href="/agents" css="color:#4ADE80">Agents</A>. Each one shows whether it is healthy, degraded or failing, its recent pass rate, a 14-day activity chart, and the exact reason of its last failure. If your agent crashes, the SDK records the run as failed with the error, so it shows up instead of vanishing.</P>
        </Step>
      </div>

      <div style={s("display:flex;gap:10px;flex-wrap:wrap")}>
        <A href="/docs/examples" css="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:13px">More examples</A>
        <A href="/docs/sdk" css="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:13px">SDK reference</A>
        <A href="/docs/overview" css="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:8px;border:1px solid #303832;color:#E8ECE9;font-size:13px">What is Verid?</A>
        <Btn onClick={ob.reload} css={ghostBtn} hover={ghostHover}>Refresh</Btn>
      </div>
    </Page>
  );
}
