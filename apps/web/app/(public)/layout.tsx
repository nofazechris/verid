"use client";

import type { ReactNode } from "react";
import { s } from "@/lib/style";
import { A } from "@/components/ui";
import { Logo, MONO } from "@/components/kit";
import { useSession } from "@/lib/client/session";

export default function PublicLayout({ children }: { children: ReactNode }) {
  const { status } = useSession();
  return (
    <div style={s("min-height:100vh;background:#0B0D0C;color:#E8ECE9;font-size:14px;line-height:1.5")}>
      <header style={s("position:sticky;top:0;z-index:20;height:64px;display:flex;align-items:center;gap:32px;padding:0 40px;background:rgba(11,13,12,0.85);backdrop-filter:blur(14px);border-bottom:1px solid #1A1F1C")}>
        <A href="/" css="display:flex;align-items:center;gap:10px;color:#E8ECE9;flex:none">
          <Logo size={18} />
          <span style={s(`height:20px;display:inline-flex;align-items:center;padding:0 7px;border-radius:5px;border:1px solid #303832;font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:#9BA39E`)}>PUBLIC PROOF</span>
        </A>
        <nav style={s("display:flex;gap:24px;font-size:14px")}>
          <A href="/proof/verify" css="color:#9BA39E">Verify</A>
          <A href="/docs" css="color:#9BA39E">Documentation</A>
        </nav>
        <div style={s("margin-left:auto")}>
          <A href={status === "authed" ? "/overview" : "/login"} css="display:inline-flex;align-items:center;height:34px;padding:0 14px;border-radius:8px;background:#E8ECE9;color:#0B0D0C;font-size:13.5px;font-weight:500;white-space:nowrap" hover="background:#FFFFFF;color:#0B0D0C">{status === "authed" ? "Open dashboard" : "Sign in"}</A>
        </div>
      </header>
      <div style={s("max-width:1100px;margin:0 auto;padding:48px 40px 96px")}>{children}</div>
    </div>
  );
}
