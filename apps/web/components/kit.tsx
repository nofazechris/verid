"use client";

import type { ReactNode } from "react";
import { s } from "@/lib/style";
import { ApiClientError } from "@/lib/client/api";
import type { Badge } from "@/lib/client/format";
import { Btn } from "./ui";

export const MONO = "'Geist Mono',monospace";

export function Page({ children }: { children: ReactNode }) {
  return <div style={s("animation:apFade .3s ease both;display:flex;flex-direction:column;gap:24px")}>{children}</div>;
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div style={s("display:flex;align-items:flex-end;gap:24px;flex-wrap:wrap")}>
      <div>
        <h1 style={s("margin:0;font-size:30px;letter-spacing:-0.025em;font-weight:600")}>{title}</h1>
        {sub && <p style={s("margin:6px 0 0;color:#9BA39E")}>{sub}</p>}
      </div>
      {right && <div style={s("margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>{right}</div>}
    </div>
  );
}

export function Card({ children, pad = 22, gap, css = "" }: { children: ReactNode; pad?: number; gap?: number; css?: string }) {
  return (
    <div style={s(`border:1px solid #252B27;border-radius:12px;background:#101311;padding:${pad}px;${gap ? `display:flex;flex-direction:column;gap:${gap}px;` : ""}${css}`)}>
      {children}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:#7C847F`)}>{children}</span>;
}

export function Mono({ children, color = "#E8ECE9", size = 12.5 }: { children: ReactNode; color?: string; size?: number }) {
  return <span style={s(`font-family:${MONO};font-size:${size}px;color:${color}`)}>{children}</span>;
}

export function Pill({ b, large }: { b: Badge; large?: boolean }) {
  return (
    <span
      style={s(
        `display:inline-flex;align-items:center;gap:6px;height:${large ? 26 : 22}px;padding:0 ${large ? 10 : 8}px;border-radius:6px;font-family:${MONO};font-size:${large ? 11.5 : 11}px;letter-spacing:0.06em;color:${b.fg};background:${b.bg};border:1px solid ${b.bd};white-space:nowrap`,
      )}
    >
      {b.icon} {b.label}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-label="Loading"
      style={s(`display:inline-block;width:${size}px;height:${size}px;border-radius:50%;border:1.5px solid rgba(232,236,233,0.22);border-top-color:#E8ECE9;animation:apSpin .7s linear infinite`)}
    />
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div style={s("padding:48px 0;display:flex;align-items:center;gap:12px;color:#7C847F;font-size:13.5px")}>
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error as ApiClientError;
  const forbidden = e?.status === 403;
  const message = forbidden ? "You don't have permission to view this." : e?.message ?? "Something went wrong.";
  return (
    <div style={s("border:1px solid rgba(166,93,93,0.35);border-radius:12px;background:#140F0F;padding:20px 22px;display:flex;align-items:center;gap:16px;flex-wrap:wrap")}>
      <span style={s(`font-family:${MONO};color:#D08A8A`)}>✕</span>
      <div style={s("display:flex;flex-direction:column;gap:2px")}>
        <span style={s("font-size:14px;color:#E8ECE9")}>{message}</span>
        {e?.code && e.code !== "error" && <span style={s(`font-family:${MONO};font-size:11px;color:#7C847F`)}>{e.code}</span>}
      </div>
      {retry && (
        <Btn onClick={retry} css="margin-left:auto;height:32px;padding:0 12px;border-radius:8px;border:1px solid #303832;background:transparent;color:#E8ECE9;font-size:13px;cursor:pointer" hover="background:#1A1616">
          Retry
        </Btn>
      )}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div style={s("padding:56px 24px;display:flex;flex-direction:column;align-items:flex-start;gap:10px;max-width:460px;margin:0 auto")}>
      <span style={s("font-size:18px;font-weight:500")}>{title}</span>
      {text && <span style={s("color:#9BA39E;font-size:13.5px;line-height:1.55")}>{text}</span>}
      {action}
    </div>
  );
}

export const primaryBtn = "height:36px;padding:0 14px;border-radius:8px;border:0;background:#E8ECE9;color:#0B0D0C;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:transform .15s ease";
export const primaryHover = "background:#FFFFFF;transform:scale(1.01)";
export const ghostBtn = "height:36px;padding:0 14px;border-radius:8px;border:1px solid #303832;background:transparent;color:#E8ECE9;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s ease";
export const ghostHover = "background:#151917";
export const inputCss = "height:36px;padding:0 12px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;font-size:13.5px;outline:none;transition:border-color .15s ease";

/** Grid table frame with a header row. `cols` is the CSS grid-template-columns shared by header and rows. */
export function Table({ cols, head, minWidth, children }: { cols: string; head: string[]; minWidth?: number; children: ReactNode }) {
  return (
    <div style={s("border:1px solid #252B27;border-radius:12px;background:#101311;overflow-x:auto")}>
      <div style={{ minWidth }}>
        <div style={s(`display:grid;grid-template-columns:${cols};gap:16px;align-items:center;height:40px;padding:0 20px;border-bottom:1px solid #1D221F;font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:#7C847F`)}>
          {head.map((h, i) => (
            <span key={i}>{h}</span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export const rowCss = (cols: string, h = 52) =>
  `display:grid;grid-template-columns:${cols};gap:16px;align-items:center;height:${h}px;padding:0 20px;border-bottom:1px solid #161A18;color:#E8ECE9;transition:background .15s ease`;

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div style={s("display:grid;grid-template-columns:auto 1fr;gap:10px 24px;font-size:13.5px")}>
      {rows.map(([k, v], i) => (
        <span key={i} style={{ display: "contents" }}>
          <span style={s("color:#7C847F")}>{k}</span>
          <span style={s("min-width:0;overflow-wrap:anywhere")}>{v}</span>
        </span>
      ))}
    </div>
  );
}

export function Logo({ size = 16, text = true }: { size?: number; text?: boolean }) {
  return (
    <span style={s("display:flex;align-items:center;gap:10px")}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#4ADE80" style={{ display: "block", flex: "none" }}>
        <path d="M1 1.8L3.2 4.4L5 1.2L12 21.6Z" />
        <path d="M23 1.8L20.8 4.4L19 1.2L12 21.6Z" />
      </svg>
      {text && <span style={s(`font-family:${MONO};font-size:12px;font-weight:500;letter-spacing:0.16em`)}>VERID</span>}
    </span>
  );
}
