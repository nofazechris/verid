"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { s } from "@/lib/style";
import { A, Field } from "@/components/ui";
import { Logo, MONO } from "@/components/kit";

const SIG = ["AGENT", "EVIDENCE", "VERIFY"];

/** Same visual system as the product: graphite card over a faint grid with the signal-line header. */
export default function AuthShell({
  title, sub, foot, children, successLabel,
}: {
  title: string;
  sub?: ReactNode;
  foot?: string;
  children: ReactNode;
  /** When set, shows the full-screen "signal complete" overlay with this label. */
  successLabel?: string;
}) {
  const [sig, setSig] = useState(0);
  useEffect(() => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSig(3);
      return;
    }
    const t = setInterval(() => setSig((x) => (x >= 4 ? 0 : x + 1)), 1400);
    return () => clearInterval(t);
  }, []);
  const lit = successLabel ? 3 : Math.min(sig, 3);

  return (
    <div style={s("position:relative;min-height:100vh;background:#0B0D0C;color:#E8ECE9;font-size:14px;line-height:1.5;display:flex;justify-content:center;align-items:flex-start;padding:max(24px,min(8vh,72px)) 20px 56px;overflow:hidden")}>
      <div style={s("position:absolute;inset:0;background-image:linear-gradient(#0F1412 1px,transparent 1px),linear-gradient(90deg,#0F1412 1px,transparent 1px);background-size:32px 32px;pointer-events:none")} />
      <div style={s("position:relative;width:100%;max-width:428px;display:flex;flex-direction:column;gap:20px")}>
        <div style={s("display:flex;align-items:center;gap:0;padding:0 4px")} aria-hidden>
          {SIG.map((label, i) => {
            const on = lit > i;
            return (
              <Fragment key={label}>
                <span style={s("display:flex;align-items:center;gap:8px;flex:none")}>
                  <span style={s(`width:7px;height:7px;border-radius:50%;background:${on ? "#1F6B4F" : "#101311"};border:1px solid ${on ? "#2C8A66" : "#252B27"};box-shadow:${on ? "0 0 10px rgba(74,222,128,0.35)" : "none"};transition:all .5s ease`)} />
                  <span style={s(`font-family:${MONO};font-size:10px;letter-spacing:0.14em;color:${on ? "#7C847F" : "#4D5450"};white-space:nowrap;transition:color .5s ease`)}>{label}</span>
                </span>
                <span style={s("flex:1;height:1px;min-width:12px;background:#161B18;position:relative")}>
                  <span style={s(`position:absolute;inset:0;width:${lit > i + 1 || successLabel ? 100 : lit > i ? 55 : 0}%;background:#1F6B4F;transition:width .7s cubic-bezier(.4,0,.2,1)`)} />
                </span>
              </Fragment>
            );
          })}
          <span style={s(`width:7px;height:7px;border-radius:50%;background:${successLabel ? "#10241A" : "#101311"};border:1px solid ${successLabel ? "#4ADE80" : "#252B27"};flex:none;transition:all .5s ease`)} />
        </div>

        <div style={s("background:#151917;border:1px solid #252B27;border-radius:16px;box-shadow:0 30px 90px -50px rgba(0,0,0,0.9);padding:36px 32px 28px;display:flex;flex-direction:column;gap:24px")}>
          <div style={s("display:flex;flex-direction:column;gap:14px")}>
            <A href="/" css="display:flex;color:#E8ECE9;width:fit-content"><Logo size={17} /></A>
            <h1 style={s("margin:8px 0 0;font-size:25px;letter-spacing:-0.02em;font-weight:600;line-height:1.15")}>{title}</h1>
            {sub && <p style={s("margin:0;color:#9BA39E;font-size:14px;text-wrap:pretty")}>{sub}</p>}
          </div>
          {children}
        </div>
        {foot && <span style={s(`text-align:center;font-family:${MONO};font-size:10.5px;letter-spacing:0.12em;color:#4D5450`)}>{foot}</span>}
      </div>

      <div
        aria-hidden={!successLabel}
        style={s(`position:fixed;inset:0;z-index:50;background:#0B0D0C;display:grid;place-items:center;opacity:${successLabel ? 1 : 0};pointer-events:${successLabel ? "auto" : "none"};transition:opacity .35s ease`)}
      >
        <div style={s("display:flex;flex-direction:column;align-items:center;gap:22px")}>
          <span style={s("width:30px;height:30px;border-radius:50%;border:1px solid #4ADE80;background:#10241A;color:#4ADE80;display:grid;place-items:center;font-size:13px;box-shadow:0 0 0 4px rgba(74,222,128,0.10), 0 0 28px rgba(74,222,128,0.4)")}>✓</span>
          <span style={s(`font-family:${MONO};font-size:13px;letter-spacing:0.2em;color:#4ADE80`)}>{successLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function AuthField({
  id, label, type = "text", value, onChange, placeholder, autoComplete, error, aside, disabled,
}: {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  autoComplete?: string; error?: string; aside?: ReactNode; disabled?: boolean;
}) {
  return (
    <div style={s("display:flex;flex-direction:column;gap:7px")}>
      <div style={s("display:flex;align-items:baseline;gap:12px;min-width:0")}>
        <label htmlFor={id} style={s("font-size:13px;font-weight:500;color:#C8D0CB")}>{label}</label>
        {aside}
      </div>
      <Field
        id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled}
        css={`height:46px;padding:0 14px;border-radius:12px;border:1px solid ${error ? "#A65D5D" : "#303832"};background:#101311;color:#E8ECE9;font-size:14.5px;outline:none;opacity:${disabled ? 0.6 : 1};transition:border-color .18s ease`}
        focus="border-color:#2C8A66"
      />
      {error && <span style={s("font-size:12.5px;color:#D08A8A")} role="alert">{error}</span>}
    </div>
  );
}

export function PasswordRules({ value }: { value: string }) {
  const rules: [string, boolean][] = [["8+ characters", value.length >= 8], ["One uppercase", /[A-Z]/.test(value)], ["One number", /[0-9]/.test(value)]];
  return (
    <div style={s("display:flex;gap:14px;flex-wrap:wrap;margin-top:-6px")}>
      {rules.map(([label, ok]) => (
        <span key={label} style={s(`display:flex;align-items:center;gap:6px;font-family:${MONO};font-size:11px;color:${ok ? "#4ADE80" : "#6B736E"};transition:color .2s ease`)}>
          <span>{ok ? "✓" : "·"}</span>
          {label}
        </span>
      ))}
    </div>
  );
}

export const passwordOk = (v: string) => v.length >= 8 && v.length <= 128 && /[A-Z]/.test(v) && /[0-9]/.test(v);

export function FormError({ message }: { message: string }) {
  return (
    <div role="alert" style={s("display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid rgba(166,93,93,0.38);border-radius:10px;background:#140F0F;animation:apFade .25s ease both")}>
      <span style={s(`font-family:${MONO};color:#D08A8A;font-size:12px`)}>✕</span>
      <span style={s("font-size:13px;color:#D08A8A")}>{message}</span>
    </div>
  );
}

export const ctaCss = (busy: boolean) =>
  `height:46px;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:12px;border:1px solid #2C8A66;background:${busy ? "#1A5540" : "#1F6B4F"};color:#E8ECE9;font-size:14.5px;font-weight:500;cursor:${busy ? "default" : "pointer"};opacity:${busy ? 0.75 : 1};transition:background .18s ease, transform .15s ease`;

export const secondaryCss = "height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #303832;background:transparent;color:#E8ECE9;font-size:14px;cursor:pointer;transition:background .18s ease";

/** Only same-origin relative paths are accepted for post-login redirects (blocks open-redirects). */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/overview";
}

/** The official multicolour Google "G", for "Continue with Google" buttons. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
