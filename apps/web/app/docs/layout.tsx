"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { s } from "@/lib/style";
import { A } from "@/components/ui";
import { Logo, MONO } from "@/components/kit";
import { useSession } from "@/lib/client/session";

const NAV: { title: string; items: [string, string][] }[] = [
  { title: "OVERVIEW", items: [["What is Verid?", "/docs/overview"], ["Trust model", "/docs/trust-model"]] },
  { title: "GET STARTED", items: [["Quickstart", "/docs"], ["Build, ship & run an agent", "/docs/build-and-ship"], ["Examples", "/docs/examples"], ["Connect your agent", "/docs/integrate"], ["Authentication", "/docs/authentication"], ["SDK", "/docs/sdk"]] },
  { title: "GUIDES", items: [["Agents & monitoring", "/docs/agents"], ["Validators", "/docs/validators"], ["Settlement & escrow", "/docs/escrow"], ["Deploy to Arc", "/docs/deploy-arc"], ["Host Verid (go live)", "/docs/deploy-app"], ["Receipts & verification", "/docs/verification"], ["Command-line tool", "/docs/cli"]] },
  { title: "REFERENCE", items: [["REST API", "/docs/api"], ["Commitments & hashing", "/docs/commitments"], ["Self-hosting & configuration", "/docs/self-hosting"]] },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { status } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [path]);
  return (
    <div style={s("min-height:100vh;background:radial-gradient(ellipse 60% 30% at 80% 0%,rgba(74,222,128,0.05),transparent 70%),#070908;color:#E8ECE9;font-size:14px;line-height:1.5")}>
      <header className="vd-docs-head" style={s("position:sticky;top:0;z-index:20;height:60px;display:flex;align-items:center;gap:32px;padding:0 32px;background:rgba(11,13,12,0.85);backdrop-filter:blur(14px);border-bottom:1px solid #1A1F1C")}>
        <A href="/" css="display:flex;align-items:center;gap:10px;color:#E8ECE9;flex:none">
          <Logo />
          <span className="vd-hide-sm" style={s(`height:20px;display:inline-flex;align-items:center;padding:0 7px;border-radius:5px;border:1px solid #303832;font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:#9BA39E`)}>DOCUMENTATION</span>
        </A>
        <div style={s("margin-left:auto;display:flex;align-items:center;gap:12px")}>
          <button className="vd-menu-btn" aria-label="Toggle documentation menu" onClick={() => setNavOpen((o) => !o)} style={s("height:32px;padding:0 10px;align-items:center;gap:6px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;cursor:pointer;font-size:13px;white-space:nowrap;flex:none")}>☰ Menu</button>
          <span className="vd-hide-sm"><A href="/proof/verify" css="color:#9BA39E;font-size:13.5px">Verify a receipt</A></span>
          <A href={status === "authed" ? "/overview" : "/login"} css="display:inline-flex;align-items:center;height:32px;padding:0 14px;border-radius:8px;background:#E8ECE9;color:#0B0D0C;font-size:13px;font-weight:500;white-space:nowrap" hover="background:#FFFFFF;color:#0B0D0C">{status === "authed" ? "Open dashboard" : "Sign in"}</A>
        </div>
      </header>
      <div className="vd-docs-grid" style={s("max-width:1440px;margin:0 auto;display:grid;grid-template-columns:232px minmax(0,1fr)")}>
        <aside className={"vd-docs-side" + (navOpen ? " open" : "")} style={s("position:sticky;top:60px;height:calc(100vh - 60px);overflow-y:auto;min-width:0;padding:28px 16px;border-right:1px solid #1A1F1C;display:flex;flex-direction:column;gap:20px")}>
          {NAV.map((g) => (
            <div key={g.title} style={s("display:flex;flex-direction:column;gap:2px")}>
              <div style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.1em;color:#6B736E;padding:0 10px 6px`)}>{g.title}</div>
              {g.items.map(([label, p]) => (
                <A key={p} href={p} css={`display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:7px;background:${path === p ? "#151917" : "transparent"};color:${path === p ? "#E8ECE9" : "#9BA39E"};font-size:13.5px;white-space:nowrap`} hover="background:#151917;color:#E8ECE9">
                  <span style={s(`width:4px;height:4px;border-radius:50%;background:${path === p ? "#4ADE80" : "transparent"}`)} />
                  {label}
                </A>
              ))}
            </div>
          ))}
        </aside>
        <div className="vd-docs-body" style={s("padding:48px 56px 96px;min-width:0;display:flex;flex-direction:column;gap:20px")}>{children}</div>
      </div>
    </div>
  );
}
