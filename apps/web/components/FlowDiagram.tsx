"use client";

import { useEffect, useRef, useState } from "react";

/** The five places a run passes through, with the plain-language caption shown for each in the tour. */
export const FLOW = [
  { title: "Your agent", sub: "any code, any model", caption: "Your agent does the work wherever it runs: a script, a service, an LLM loop. Verid never runs it." },
  { title: "Verid SDK", sub: "records each step", caption: "A few lines of SDK (or plain HTTP) send what the agent was asked, each tool it called, and what came back." },
  { title: "Verid server", sub: "validates the result", caption: "Verid's own server checks the result against rules you wrote. The agent cannot mark its own homework." },
  { title: "Arc chain", sub: "fingerprint only", caption: "If it passed, only a fingerprint (a hash) of the receipt is published on Arc. None of your data goes on-chain." },
  { title: "Proof link", sub: "shareable", caption: "Anyone you send the link to can recompute the fingerprint and check it against the chain. No trust in Verid needed." },
] as const;

const X = [0, 172, 344, 536, 666];
const W = [150, 150, 170, 108, 94];

/**
 * The picture that explains the product, and the live progress bar of a run.
 *  - `stage`: -1 nothing yet, 0..4 the box that is working now, 5 everything done. Earlier boxes show as done.
 *  - `halt`: index of a box where the run stopped for a bad reason (drawn in red; later boxes stay dim).
 *  - `loop`: play the whole journey on repeat by itself (for explaining; ignores `stage`).
 */
export interface Halt {
  at: number;
  label: string;
  /** "bad" is a failure (red); "warn" is a normal stop that needs setup (amber). */
  tone?: "bad" | "warn";
}

export default function FlowDiagram({ stage = -1, halt: h, loop, onLoopStage }: { stage?: number; halt?: Halt; loop?: boolean; onLoopStage?: (n: number) => void }) {
  const halt = h?.at;
  const wrap = useRef<HTMLDivElement>(null);
  const [auto, setAuto] = useState(0);
  useEffect(() => {
    if (!loop) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => setAuto((n) => (n + 1) % 7), 1700);
    return () => clearInterval(id);
  }, [loop]);
  const cur = loop ? Math.min(auto, 5) : stage; // 5 = all done, 6 = a short pause before it restarts
  const shown = loop && auto === 6 ? -1 : cur;
  useEffect(() => {
    if (loop && onLoopStage) onLoopStage(shown);
  }, [loop, shown, onLoopStage]);

  // On a narrow screen the diagram scrolls sideways inside its own box; keep the working box in view.
  useEffect(() => {
    const el = wrap.current;
    if (!el || shown < 0 || shown > 4 || el.scrollWidth <= el.clientWidth) return;
    const center = ((X[shown]! + W[shown]! / 2) / 760) * el.scrollWidth;
    el.scrollTo({ left: Math.max(0, center - el.clientWidth / 2), behavior: "smooth" });
  }, [shown]);

  const state = (i: number): "idle" | "active" | "done" | "bad" | "warn" => {
    if (halt !== undefined && i === halt) return h?.tone === "warn" ? "warn" : "bad";
    if (halt !== undefined && i > halt) return "idle";
    if (i < shown) return "done";
    if (i === shown) return "active";
    return "idle";
  };

  return (
    <div ref={wrap} style={{ flex: "none", width: "100%", maxWidth: "100%", overflowX: "auto", overflowY: "hidden", padding: "6px 0" }}>
    <svg viewBox="0 0 760 108" width="100%" role="img" aria-label="Your agent reports through the Verid SDK to the Verid server, which validates the result and anchors a receipt on Arc, producing a proof link" style={{ display: "block", width: "100%", maxWidth: 620, minWidth: 520, margin: "0 auto" }}>
      <defs>
        <filter id="vdSoft" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="7" /></filter>
      </defs>
      {FLOW.map((f, i) => {
        const st = state(i);
        const stroke = st === "bad" ? "#C0524E" : st === "warn" ? "#B89A5A" : st === "active" ? "#4ADE80" : st === "done" ? "#2C8A66" : "#252B27";
        const fill = st === "bad" ? "#1A1010" : st === "warn" ? "#17130B" : st === "active" ? "#0F1B14" : st === "done" ? "#0F1512" : "#101311";
        const x = X[i]!, w = W[i]!;
        return (
          <g key={f.title} style={{ transition: "opacity .3s ease" }} opacity={st === "idle" && shown >= 0 ? 0.55 : 1}>
            {st === "active" && <rect className="vd-glow" x={x} y={14} width={w} height={74} rx={10} fill="#4ADE80" opacity={0.35} filter="url(#vdSoft)" />}
            <rect x={x} y={14} width={w} height={74} rx={10} fill={fill} stroke={stroke} strokeWidth={st === "active" ? 1.5 : 1} style={{ transition: "all .3s ease" }} />
            <text x={x + w / 2} y={44} textAnchor="middle" fontSize="13" fontWeight="500" fill="#E8ECE9" fontFamily="Geist, sans-serif">{f.title}</text>
            <text x={x + w / 2} y={64} textAnchor="middle" fontSize="10.5" fill={st === "bad" ? "#E08C88" : st === "warn" ? "#CDB274" : "#7C847F"} fontFamily="'Geist Mono',monospace">{st === "bad" || st === "warn" ? h?.label : f.sub}</text>
            {st === "done" && (
              <g>
                <circle cx={x + w - 4} cy={18} r={9} fill="#10241A" stroke="#2C8A66" />
                <path d={`M${x + w - 8.5} 18.5 l3 3 l5 -6`} stroke="#4ADE80" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        );
      })}
      {[0, 1, 2, 3].map((i) => {
        const x1 = X[i]! + W[i]! + 2;
        const x2 = X[i + 1]! - 2;
        const flowing = state(i) === "active" && (halt === undefined || i < halt);
        const passed = i < shown && (halt === undefined || i < halt);
        return (
          <g key={i}>
            <line x1={x1} y1={51} x2={x2 - 6} y2={51} stroke={passed ? "#2C8A66" : flowing ? "#4ADE80" : "#3A443D"} strokeWidth="1.5" className={flowing ? "vd-flow-line" : undefined} style={{ transition: "stroke .3s ease" }} />
            <path d={`M${x2 - 7} 46 l6 5 l-6 5`} stroke={passed ? "#2C8A66" : flowing ? "#4ADE80" : "#3A443D"} fill="none" strokeWidth="1.5" style={{ transition: "stroke .3s ease" }} />
          </g>
        );
      })}
    </svg>
    </div>
  );
}
