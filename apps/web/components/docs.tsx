"use client";

import type { ReactNode } from "react";
import { s } from "@/lib/style";
import { Btn } from "@/components/ui";
import { MONO } from "@/components/kit";
import { useSession } from "@/lib/client/session";

export function H1({ children, kicker }: { children: ReactNode; kicker?: string }) {
  return (
    <div style={s("display:flex;flex-direction:column;gap:12px;max-width:760px")}>
      {kicker && <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:#7C847F`)}>{kicker}</span>}
      <h1 style={s("margin:0;font-size:40px;letter-spacing:-0.03em;font-weight:600;line-height:1.05")}>{children}</h1>
    </div>
  );
}
export const H2 = ({ children }: { children: ReactNode }) => <h2 style={s("margin:20px 0 0;font-size:22px;letter-spacing:-0.015em;font-weight:600")}>{children}</h2>;
export const P = ({ children }: { children: ReactNode }) => <p style={s("margin:0;color:#9BA39E;font-size:15px;line-height:1.7;max-width:760px")}>{children}</p>;
export const Code = ({ children }: { children: ReactNode }) => <code style={s(`font-family:${MONO};font-size:12.5px;color:#E8ECE9;background:#151917;border:1px solid #252B27;border-radius:5px;padding:1px 6px`)}>{children}</code>;

export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={s("border:1px solid #252B27;border-radius:10px;background:#0F1210;padding:16px 18px;max-width:760px;display:flex;flex-direction:column;gap:6px")}>
      <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:#CDB274`)}>{title}</span>
      <span style={s("font-size:13.5px;color:#9BA39E;line-height:1.65")}>{children}</span>
    </div>
  );
}

export function CodeBlock({ title, children }: { title?: string; children: string }) {
  const { toast } = useSession();
  return (
    <div style={s("border:1px solid #252B27;border-radius:10px;background:#0A0C0B;overflow:hidden;max-width:820px")}>
      <div style={s("display:flex;align-items:center;gap:10px;height:38px;padding:0 12px 0 16px;border-bottom:1px solid #1A1F1C;background:#101311")}>
        <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:#7C847F`)}>{title ?? "SHELL"}</span>
        <Btn onClick={() => { void navigator.clipboard?.writeText(children); toast("Copied"); }} css="margin-left:auto;height:24px;padding:0 10px;border-radius:6px;border:1px solid #252B27;background:transparent;color:#9BA39E;font-size:12px;cursor:pointer" hover="border-color:#303832;color:#E8ECE9">Copy</Btn>
      </div>
      <pre style={s(`margin:0;padding:14px 16px;overflow-x:auto;font-family:${MONO};font-size:12.5px;line-height:1.7;color:#C8D0CB`)}>{children}</pre>
    </div>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return <ul style={{ margin: 0, paddingLeft: 20, color: "#9BA39E", fontSize: 14.5, lineHeight: 1.8, maxWidth: 760 }}>{children}</ul>;
}
export function OL({ children }: { children: ReactNode }) {
  return <ol style={{ margin: 0, paddingLeft: 22, color: "#9BA39E", fontSize: 14.5, lineHeight: 1.8, maxWidth: 760 }}>{children}</ol>;
}
export const H3 = ({ children }: { children: ReactNode }) => <h3 style={s("margin:12px 0 0;font-size:16px;letter-spacing:-0.01em;font-weight:600;color:#E8ECE9")}>{children}</h3>;

/** Simple responsive-ish table. `cols` is a CSS grid-template-columns value. */
export function Table({ head, rows, cols }: { head: string[]; rows: ReactNode[][]; cols?: string }) {
  const grid = cols ?? `repeat(${head.length},minmax(0,1fr))`;
  return (
    <div style={s("border:1px solid #252B27;border-radius:12px;background:#101311;max-width:960px;overflow-x:auto")}>
      <div style={{ minWidth: 560 }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 16, padding: "12px 18px", borderBottom: "1px solid #1D221F", fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: "#7C847F" }}>
          {head.map((h) => <span key={h}>{h}</span>)}
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: grid, gap: 16, padding: "12px 18px", borderBottom: "1px solid #161A18", fontSize: 13, lineHeight: 1.55, color: "#9BA39E" }}>
            {r.map((c, j) => <span key={j} style={{ minWidth: 0, overflowWrap: "anywhere", color: j === 0 ? "#C8D0CB" : undefined }}>{c}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}
