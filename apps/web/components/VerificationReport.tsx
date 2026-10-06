"use client";

import { s } from "@/lib/style";
import { MONO, Pill } from "./kit";
import { checkBadge } from "@/lib/client/format";

export interface Check {
  id: string;
  label: string;
  status: string;
  detail?: string;
}
export interface Report {
  outcome: "verified" | "incomplete" | "invalid";
  checks: Check[];
}

const OUTCOME = {
  verified: { fg: "#4ADE80", bd: "rgba(74,222,128,0.28)", bg: "#0E1813", title: "VERIFICATION COMPLETE", text: "Every check ran and passed." },
  incomplete: { fg: "#CDB274", bd: "rgba(184,154,90,0.30)", bg: "#16130C", title: "VERIFICATION INCOMPLETE", text: "No check failed, but some could not be performed. Anything marked NOT_CHECKED or UNAVAILABLE was NOT verified." },
  invalid: { fg: "#D08A8A", bd: "rgba(166,93,93,0.38)", bg: "#140F0F", title: "VERIFICATION FAILED", text: "The receipt is invalid or inconsistent with the supplied data." },
} as const;

/** Explicit per-check results. Deliberately NOT collapsed into one unexplained badge or score. */
export default function VerificationReport({ report }: { report: Report }) {
  const o = OUTCOME[report.outcome];
  return (
    <div style={s(`border:1px solid ${o.bd};border-radius:14px;background:${o.bg};padding:24px;display:flex;flex-direction:column;gap:16px;animation:apFade .35s ease both`)}>
      <div style={s("display:flex;flex-direction:column;gap:4px")}>
        <span style={s(`font-family:${MONO};font-size:15px;letter-spacing:0.08em;color:${o.fg};font-weight:500`)}>{o.title}</span>
        <span style={s("font-size:13px;color:#9BA39E")}>{o.text}</span>
      </div>
      <div style={s("display:flex;flex-direction:column")}>
        {report.checks.map((c) => (
          <div key={c.id} style={s("display:grid;grid-template-columns:minmax(150px,200px) auto minmax(0,1fr);gap:16px;align-items:center;min-height:42px;border-top:1px solid rgba(255,255,255,0.05);padding:6px 0")}>
            <span style={s("font-size:13.5px;color:#C8D0CB")}>{c.label}</span>
            <span><Pill b={checkBadge(c.status)} /></span>
            <span style={s(`font-family:${MONO};font-size:11.5px;color:#7C847F;overflow-wrap:anywhere`)}>{c.detail ?? ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
