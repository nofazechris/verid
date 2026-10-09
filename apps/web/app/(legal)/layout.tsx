import type { ReactNode } from "react";
import { s } from "@/lib/style";
import { A } from "@/components/ui";
import { Logo, MONO } from "@/components/kit";

/** Plain, readable shell for the legal pages (no app chrome). */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div style={s("min-height:100vh;background:#0B0D0C;color:#E8ECE9;font-size:14px;line-height:1.5")}>
      <header style={s("height:64px;display:flex;align-items:center;gap:24px;padding:0 32px;border-bottom:1px solid #1A1F1C")}>
        <A href="/" css="display:flex;align-items:center;color:#E8ECE9"><Logo size={18} /></A>
        <nav style={s(`margin-left:auto;display:flex;gap:20px;font-size:13px;font-family:${MONO}`)}>
          <A href="/terms" css="color:#9BA39E">Terms</A>
          <A href="/privacy" css="color:#9BA39E">Privacy</A>
          <A href="/docs" css="color:#9BA39E">Docs</A>
        </nav>
      </header>
      <main style={s("max-width:760px;margin:0 auto;padding:56px 24px 112px;display:flex;flex-direction:column;gap:16px")}>{children}</main>
    </div>
  );
}
