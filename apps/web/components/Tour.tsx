"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { s } from "@/lib/style";
import { A, Btn, Field } from "@/components/ui";
import FlowDiagram, { FLOW, type Halt } from "@/components/FlowDiagram";
import TourCode from "@/components/TourCode";
import { Mono, Spinner, MONO, ghostBtn, ghostHover, primaryBtn, primaryHover } from "@/components/kit";
import { errorMessage } from "@/lib/client/api";
import { explorerTxUrl, short } from "@/lib/client/format";
import { runSampleAgent, SAMPLE_RULES_SUMMARY, type SampleEvent, type SampleOutcome } from "@/lib/client/sample-agent";
import { useCan } from "@/lib/client/session";

const KEY = "verid.tour.done";
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // storage blocked: never nag
  }
}
function markTourSeen() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}

interface Run {
  running: boolean;
  events: SampleEvent[];
  outcome?: SampleOutcome;
  error?: string;
}
const EMPTY: Run = { running: false, events: [] };

/** Where the flow diagram should be, and where (if anywhere) it stopped, for a run in whatever state it is in. */
function flowFor(r: Run): { stage: number; halt?: Halt } {
  const o = r.outcome;
  if (!o) {
    const last = r.events[r.events.length - 1];
    return { stage: r.running ? last?.stage ?? 0 : -1 };
  }
  if (o.crashed) return { stage: 0, halt: { at: 0, label: "crashed" } };
  if (!o.passed) return { stage: 2, halt: { at: 2, label: "failed here" } };
  if (!o.anchor) return { stage: 4, halt: { at: 3, label: "no chain set up", tone: "warn" } };
  return { stage: 5 };
}

const Bullet = ({ kind }: { kind: SampleEvent["kind"] }) => (
  <span style={s(`flex:none;margin-top:6px;width:6px;height:6px;border-radius:50%;background:${kind === "ok" ? "#4ADE80" : kind === "bad" ? "#E08C88" : "#5B645E"}`)} />
);

function Log({ events, running }: { events: SampleEvent[]; running: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the log itself (scrollIntoView would also scroll the modal and the page).
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [events.length]);
  if (!events.length && !running) return null;
  return (
    <div ref={box} style={s("flex:none;display:flex;flex-direction:column;gap:7px;padding:14px 16px;border:1px solid #1D221F;border-radius:10px;background:#0A0C0B;max-height:190px;overflow-y:auto")} aria-live="polite">
      {events.map((e, i) => (
        <div key={i} style={s(`display:flex;gap:10px;font-size:12.8px;line-height:1.55;color:${e.kind === "bad" ? "#E08C88" : e.kind === "ok" ? "#C8D0CB" : "#9BA39E"};animation:vdFade .25s ease`)}>
          <Bullet kind={e.kind} />
          <span style={s("min-width:0;overflow-wrap:anywhere")}>{e.message}</span>
        </div>
      ))}
      {running && <div style={s("display:flex;align-items:center;gap:10px;font-size:12.5px;color:#7C847F")}><Spinner size={11} /> working…</div>}
    </div>
  );
}

const P = ({ children }: { children: ReactNode }) => <p style={s("margin:0;font-size:14px;line-height:1.7;color:#9BA39E")}>{children}</p>;
const B = ({ children }: { children: ReactNode }) => <b style={{ color: "#E8ECE9", fontWeight: 500 }}>{children}</b>;

function Verdict({ o }: { o: SampleOutcome }) {
  const ok = o.passed;
  return (
    <div style={s(`display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid ${ok ? "#2C8A66" : "#5A2A28"};border-radius:10px;background:${ok ? "#0F1512" : "#150E0E"}`)}>
      <div style={s("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <span style={s(`font-family:${MONO};font-size:11.5px;letter-spacing:0.08em;padding:3px 9px;border-radius:6px;border:1px solid ${ok ? "#2C8A66" : "#7A3431"};color:${ok ? "#4ADE80" : "#E08C88"}`)}>{o.crashed ? "AGENT CRASHED" : ok ? "PASS" : "FAIL"}</span>
        <span style={s("font-size:13px;color:#9BA39E")}>validator <Mono size={12}>{o.validatorLabel}</Mono></span>
      </div>
      {o.crashed ? (
        <span style={s("font-size:13px;line-height:1.6;color:#E08C88")}>{o.crashed}</span>
      ) : (
        <div style={s("display:flex;flex-direction:column;gap:6px")}>
          {o.checks.map((c, i) => (
            <div key={i} style={s("display:flex;gap:10px;font-size:12.8px;line-height:1.55")}>
              <span style={s(`flex:none;width:14px;color:${!c.determinate ? "#7C847F" : c.ok ? "#4ADE80" : "#E08C88"}`)}>{!c.determinate ? "·" : c.ok ? "✓" : "✕"}</span>
              <span style={s("min-width:0")}>
                <span style={{ color: c.ok ? "#C8D0CB" : "#E8ECE9" }}>{c.description}</span>
                {c.explanation && <span style={s("display:block;color:#E08C88;margin-top:2px;overflow-wrap:anywhere")}>{c.explanation}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Tour({ onClose }: { onClose: () => void }) {
  const canRun = useCan("developer");
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("ai-agents");
  const [good, setGood] = useState<Run>(EMPTY);
  const [bad, setBad] = useState<Run>(EMPTY);
  const [caption, setCaption] = useState(-1);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // React dev mounts effects twice; the flag must come back on
    return () => {
      alive.current = false;
    };
  }, []);

  const close = useCallback(() => {
    markTourSeen();
    onClose();
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  const go = async (broken: boolean) => {
    const set = broken ? setBad : setGood;
    const clean = topic.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "ai-agents";
    set({ running: true, events: [] });
    try {
      const outcome = await runSampleAgent({
        topic: clean,
        minimum: 5,
        broken,
        onEvent: (e) => alive.current && set((r) => ({ ...r, events: [...r.events, e] })),
      });
      alive.current && set((r) => ({ ...r, running: false, outcome }));
    } catch (e) {
      alive.current && set((r) => ({ ...r, running: false, error: errorMessage(e) }));
    }
  };

  const TITLES = ["How it works", "The code, running live", "What just happened", "Now break it", "Connect yours"];
  const last = TITLES.length - 1;
  const goodDone = !!good.outcome;
  const nextBlocked = (step === 1 && !goodDone) || good.running || bad.running;

  const flowGood = flowFor(good);
  const flowBad = flowFor(bad);

  const body: ReactNode = (() => {
    switch (step) {
      case 0:
        return (
          <>
            <FlowDiagram loop onLoopStage={setCaption} />
            <div style={s("min-height:62px;display:flex;flex-direction:column;gap:6px;max-width:620px;margin:0 auto;text-align:center")}>
              {caption >= 0 && caption < 5 ? (
                <div key={caption} style={s("animation:vdFade .3s ease")}>
                  <div style={s("font-size:15px;font-weight:500;margin-bottom:4px")}>{FLOW[caption]!.title}</div>
                  <P>{FLOW[caption]!.caption}</P>
                </div>
              ) : (
                <P>{caption === 5 ? "That is the whole journey. Next, you will watch a real agent make it." : "Watch a run travel through Verid."}</P>
              )}
            </div>
            <P>
              Verid does not run your agent. Your agent runs wherever it lives and <B>reports in</B>. Verid records what it did, checks the result on its own server, and publishes a fingerprint on Arc so anyone can verify it later without trusting Verid or you. This tour takes about two minutes and uses a real agent.
            </P>
          </>
        );
      case 1:
        return (
          <>
            <P>
              On the left is the code a developer writes. On the right it runs for real: this sample searches GitHub&rsquo;s public API from your browser and reports every step to <B>your workspace</B>, over the same API an SDK uses. Pick a topic and run it, and watch the code light up.
            </P>
            <FlowDiagram stage={flowGood.stage} halt={flowGood.halt} />
            <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr));gap:16px;align-items:start")}>
              <TourCode active={good.events[good.events.length - 1]?.code} running={good.running} />
              <div style={s("display:flex;flex-direction:column;gap:14px;min-width:0")}>
            <div style={s("display:flex;gap:10px;flex-wrap:wrap;align-items:center")}>
              <Field value={topic} onChange={(e) => setTopic(e.target.value)} disabled={good.running} aria-label="GitHub topic" placeholder="a GitHub topic, e.g. ai-agents" css="height:38px;width:240px;max-width:100%;padding:0 12px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;font-size:13.5px;outline:none" focus="border-color:#2C8A66" />
              {["ai-agents", "rust-lang", "llm"].map((t) => (
                <Btn key={t} onClick={() => setTopic(t)} disabled={good.running} css={`height:30px;padding:0 10px;border-radius:7px;border:1px solid ${topic === t ? "#3A443D" : "#252B27"};background:${topic === t ? "#151917" : "transparent"};color:#9BA39E;font-size:12px;font-family:${MONO};cursor:pointer`} hover="color:#E8ECE9">{t}</Btn>
              ))}
              <Btn onClick={() => void go(false)} disabled={good.running || !canRun} css={`${primaryBtn};height:38px;padding:0 18px;${good.running || !canRun ? "opacity:.5;cursor:default" : ""}`} hover={primaryHover}>{goodDone ? "Run it again" : "Run the agent"}</Btn>
            </div>
            {!canRun && <P>Your role in this workspace is read-only, so you cannot report runs. Ask an owner for the developer role to try the sample.</P>}
            <Log events={good.events} running={good.running} />
            {good.error && <span style={s("font-size:13px;color:#E08C88")}>{good.error}</span>}
            {goodDone && !good.running && <span style={s("font-size:13px;color:#4ADE80")}>Done. Press Next to see what was recorded.</span>}
              </div>
            </div>
          </>
        );
      case 2: {
        const o = good.outcome;
        if (!o) return <P>Run the agent on the previous step first.</P>;
        const tx = o.anchor?.transactionHash;
        const link = explorerTxUrl(tx);
        return (
          <>
            <FlowDiagram stage={flowGood.stage} halt={flowGood.halt} />
            <Verdict o={o} />
            {o.repos.length > 0 && (
              <div style={s("display:flex;flex-direction:column;gap:2px")}>
                <span style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:#7C847F;margin-bottom:6px`)}>WHAT THE AGENT FOUND (THE RESULT)</span>
                {o.repos.map((r) => (
                  <div key={r.url} style={s("display:flex;gap:12px;font-size:13px;line-height:1.7")}>
                    <span style={s("min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.name}</span>
                    <span style={s(`font-family:${MONO};font-size:12px;color:#7C847F`)}>★ {r.stars.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={s("display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid #1D221F;border-radius:10px;background:#0F1210;font-size:13px;line-height:1.65;color:#9BA39E")}>
              <span><B>Recorded:</B> the task, the call to GitHub, GitHub&rsquo;s answer and the result, as hashed evidence.</span>
              <span><B>Checked by Verid&rsquo;s server</B> (not by the agent) against these rules: {SAMPLE_RULES_SUMMARY.join("; ")}.</span>
              {o.receiptId && <span><B>Receipt:</B> <Mono size={12}>{short(o.receiptId, 14, 4)}</Mono></span>}
              {tx ? (
                <span><B>On Arc:</B> <Mono size={12}>{short(tx, 12, 6)}</Mono>{link && <> <A href={link} target="_blank" rel="noreferrer" css="color:#4ADE80;font-size:12.5px">open in the explorer ↗</A></>}. Only fingerprints, none of this data.</span>
              ) : (
                o.anchorNote && <span style={{ color: "#CDB274" }}>{o.anchorNote}</span>
              )}
            </div>
            <div style={s(`display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid #1D221F;border-radius:10px;background:#0A0C0B;font-family:${MONO};font-size:12px;line-height:1.8;color:#9BA39E;overflow-x:auto`)}>
              <span style={s(`font-size:10.5px;letter-spacing:0.08em;color:#7C847F;margin-bottom:4px`)}>WHAT YOUR CODE GETS BACK (out)</span>
              <span style={{ whiteSpace: "pre" }}>out.status    = <span style={{ color: o.passed ? "#4ADE80" : "#E08C88" }}>&quot;{o.passed ? "pass" : "fail"}&quot;</span></span>
              <span style={{ whiteSpace: "pre" }}>out.anchored  = <span style={{ color: o.anchor ? "#4ADE80" : "#CDB274" }}>{String(!!o.anchor)}</span></span>
              <span style={{ whiteSpace: "pre" }}>out.proofUrl  = <span style={{ color: "#C8D0CB" }}>&quot;{typeof window !== "undefined" ? window.location.origin : ""}/proof/{o.receiptId ?? "…"}&quot;</span></span>
            </div>
            <div style={s("display:flex;gap:10px;flex-wrap:wrap")}>
              <A href={`/executions/${o.executionId}`} onClick={close} css={`${ghostBtn};display:inline-flex;align-items:center`} hover={ghostHover}>Inspect this run</A>
              {o.receiptId && <A href={`/proof/${o.receiptId}`} target="_blank" rel="noreferrer" css={`${ghostBtn};display:inline-flex;align-items:center`} hover={ghostHover}>Open the public proof link ↗</A>}
            </div>
          </>
        );
      }
      case 3: {
        const o = bad.outcome;
        return (
          <>
            <P>
              A verifier is only worth something if it says no. This time the agent will hand Verid a <B>deliberately broken result</B> (one repository link replaced with <Mono size={12.5}>not-a-url</Mono>). Watch what happens.
            </P>
            <FlowDiagram stage={flowBad.stage} halt={flowBad.halt} />
            <div style={s("display:flex;gap:10px;flex-wrap:wrap;align-items:center")}>
              <Btn onClick={() => void go(true)} disabled={bad.running || !canRun} css={`${primaryBtn};height:38px;padding:0 18px;${bad.running || !canRun ? "opacity:.5;cursor:default" : ""}`} hover={primaryHover}>{o ? "Break it again" : "Run it with a broken result"}</Btn>
            </div>
            <Log events={bad.events} running={bad.running} />
            {bad.error && <span style={s("font-size:13px;color:#E08C88")}>{bad.error}</span>}
            {o && !bad.running && (
              <>
                <Verdict o={o} />
                <P>
                  Verid <B>caught it</B>, said exactly which rule failed, and kept the failure as it happened. A failed run can never be anchored or paid out of escrow. Your agent could not have talked its way past this, because the rules run on Verid&rsquo;s server.
                  {o.executionId && <> <A href={`/executions/${o.executionId}`} onClick={close} css="color:#4ADE80">See the failed run</A>.</>}
                </P>
              </>
            )}
          </>
        );
      }
      default:
        return (
          <>
            <P>
              You just watched the whole loop with a sample. To do it with <B>your own agent</B>, it needs three things, and the dashboard walks you through each:
            </P>
            <div style={s("display:flex;flex-direction:column;gap:10px")}>
              {[
                ["1", "Create an API key", "It lets your code report to this workspace. Shown once; keep it on your server.", "/settings/keys", "Create a key"],
                ["2", "Add the SDK to your agent", "npm or pip, then wrap your work in one call. Copy-paste snippets are on the Get started page.", "/get-started", "See the snippets"],
                ["3", "Run it and open the proof", "Your run appears in Executions, validated, with a receipt and a proof link.", "/executions", "Open executions"],
              ].map(([n, t, d, href, cta]) => (
                <div key={n} style={s("display:flex;gap:14px;align-items:center;padding:14px 16px;border:1px solid #1D221F;border-radius:10px;background:#0F1210;flex-wrap:wrap")}>
                  <span style={s(`flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-family:${MONO};font-size:11.5px;border:1px solid #303832;color:#9BA39E`)}>{n}</span>
                  <span style={s("flex:1;min-width:200px;display:flex;flex-direction:column;gap:2px")}>
                    <span style={s("font-size:14px;font-weight:500")}>{t}</span>
                    <span style={s("font-size:12.8px;line-height:1.55;color:#9BA39E")}>{d}</span>
                  </span>
                  <A href={href!} onClick={close} css={`${ghostBtn};display:inline-flex;align-items:center;height:32px`} hover={ghostHover}>{cta}</A>
                </div>
              ))}
            </div>
            <P>
              Money in the loop? A customer can lock USDC in escrow that pays out only after a Pass and an anchor. That is the optional last step on the Get started page. You can reopen this tour any time from there.
            </P>
          </>
        );
    }
  })();

  // A portal: pages animate with a transform, which would otherwise trap `position: fixed` inside the page column.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Guided tour" style={s("position:fixed;inset:0;z-index:100;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:16px;background:rgba(5,7,6,.72);backdrop-filter:blur(3px);animation:vdFade .2s ease")} onMouseDown={(e) => e.target === e.currentTarget && !good.running && !bad.running && close()}>
      <div style={s("width:100%;min-width:0;max-width:960px;max-height:min(94vh,900px);display:flex;flex-direction:column;border:1px solid #252B27;border-radius:16px;background:#0D100E;box-shadow:0 30px 80px -20px rgba(0,0,0,.8),0 0 70px -30px rgba(74,222,128,.25);animation:vdRise .3s ease")}>
        <div style={s("display:flex;align-items:center;gap:14px;padding:16px 22px;border-bottom:1px solid #161A18")}>
          <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:#7C847F`)}>STEP {step + 1} OF {TITLES.length}</span>
          <div style={s("display:flex;gap:6px;flex:1")} aria-hidden>
            {TITLES.map((_, i) => <span key={i} style={s(`height:3px;flex:1;max-width:48px;border-radius:2px;background:${i <= step ? "#2C8A66" : "#1D221F"};transition:background .3s ease`)} />)}
          </div>
          <Btn onClick={close} aria-label="Close the tour" css="height:28px;padding:0 10px;border-radius:7px;border:1px solid #252B27;background:transparent;color:#9BA39E;font-size:12.5px;cursor:pointer" hover="color:#E8ECE9;border-color:#303832">Skip tour</Btn>
        </div>

        <div key={step} style={s("padding:22px 26px 8px;overflow-y:auto;display:flex;flex-direction:column;gap:18px;animation:vdFade .25s ease")}>
          <h2 style={s("margin:0;font-size:21px;font-weight:500;letter-spacing:-0.01em")}>{TITLES[step]}</h2>
          {body}
        </div>

        <div style={s("display:flex;align-items:center;gap:10px;padding:16px 22px;border-top:1px solid #161A18")}>
          <Btn onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0 || good.running || bad.running} css={`${ghostBtn};${step === 0 ? "visibility:hidden" : ""}`} hover={ghostHover}>Back</Btn>
          <span style={s("flex:1")} />
          {step === 1 && !goodDone && !good.running && <Btn onClick={() => setStep(3)} css="background:transparent;border:0;color:#7C847F;font-size:12.5px;cursor:pointer" hover="color:#E8ECE9">Skip the run</Btn>}
          {step < last ? (
            <Btn onClick={() => setStep((n) => n + 1)} disabled={nextBlocked} css={`${primaryBtn};${nextBlocked ? "opacity:.45;cursor:default" : ""}`} hover={primaryHover}>{step === 0 ? "Start" : "Next"}</Btn>
          ) : (
            <Btn onClick={close} css={primaryBtn} hover={primaryHover}>Done</Btn>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
