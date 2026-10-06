"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Logo, MONO, Spinner } from "@/components/kit";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

const NAV: { title: string; items: [string, string][] }[] = [
  { title: "", items: [["Get started", "/get-started"], ["Overview", "/overview"], ["Agents", "/agents"], ["Executions", "/executions"], ["Receipts", "/receipts"], ["Settlements", "/settlements"], ["Validators", "/validators"], ["Policies", "/policies"], ["Verify", "/verify"]] },
  { title: "DEVELOPER", items: [["Documentation", "/docs"], ["API Keys", "/settings/keys"]] },
  { title: "SYSTEM", items: [["Settings", "/settings"], ["Network", "/settings/network"]] },
];

const TITLES: Record<string, string> = {
  "get-started": "Get started", overview: "Overview", agents: "Agents", executions: "Executions", receipts: "Receipts", settlements: "Settlements", validators: "Validators",
  policies: "Policies", verify: "Verify", settings: "Settings",
};

export interface NetStatus {
  backend: { status: string; database: string };
  chain:
    | { status: "not_configured" }
    | { status: "ok"; chainId: number; blockNumber: number; network: string; registryAddress: string }
    | { status: "unavailable"; network: string; registryAddress: string };
}

/** Reports the VERID backend and the chain SEPARATELY, so an Arc/RPC problem never looks like a VERID outage. */
export function NetworkPill() {
  const { data } = useApi<NetStatus>("/network/status", { pollMs: 30_000 });
  if (!data) return null;
  const c = data.chain;
  const dot = data.backend.database !== "ok" ? "#A65D5D" : c.status === "ok" ? "#4ADE80" : c.status === "unavailable" ? "#CDB274" : "#6B736E";
  const text =
    data.backend.database !== "ok" ? "Backend database unavailable"
    : c.status === "ok" ? `${c.network} · chain ${c.chainId} · block #${c.blockNumber.toLocaleString("en-US")}`
    : c.status === "unavailable" ? `${c.network} · RPC unavailable`
    : "Arc not configured";
  return (
    <span style={s(`display:flex;align-items:center;gap:8px;font-family:${MONO};font-size:11.5px;color:#7C847F;white-space:nowrap`)}>
      <span style={s(`width:6px;height:6px;border-radius:50%;background:${dot}`)} />
      {text}
    </span>
  );
}

function Splash() {
  return (
    <div style={s("min-height:100vh;display:grid;place-items:center;background:#0B0D0C;color:#7C847F")}>
      <Spinner size={18} />
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname() || "/";
  const { status, me, workspaceId, workspace, setWorkspace, signOut } = useSession();

  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [path]); // close the mobile drawer after navigating

  useEffect(() => {
    if (status === "anon") router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (status === "authed" && me) {
      if (!me.user.emailVerified) router.replace("/verify-email");
      else if (me.workspaces.length === 0) router.replace("/onboarding");
    }
  }, [status, me, path, router]);

  if (status !== "authed" || !me || !me.user.emailVerified || me.workspaces.length === 0 || !workspaceId) return <Splash />;

  const segs = path.split("/").filter(Boolean);
  const best = NAV.flatMap((g) => g.items).filter(([, p]) => path === p || path.startsWith(p + "/")).sort((a, b) => b[1].length - a[1].length)[0]?.[1];
  const initials = me.user.email.slice(0, 2).toUpperCase();

  return (
    <div style={s("display:flex;min-height:100vh;background:#0B0D0C;color:#E8ECE9;font-size:14px;line-height:1.5")}>
      <div className={"vd-scrim" + (navOpen ? " open" : "")} onClick={() => setNavOpen(false)} />
      <aside className={"vd-aside" + (navOpen ? " open" : "")} style={s("position:sticky;top:0;height:100vh;width:228px;flex:none;border-right:1px solid #1A1F1C;padding:16px 12px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;overflow-x:hidden")}>
        <A href="/overview" css="display:flex;align-items:center;height:36px;padding:0 10px;color:#E8ECE9"><Logo /></A>

        {me.workspaces.length > 1 ? (
          <select aria-label="Workspace" value={workspaceId} onChange={(e) => { setWorkspace(e.target.value); router.push("/overview"); }}
            style={s("height:34px;margin:8px 0 4px;padding:0 8px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;font-size:13px;cursor:pointer")}>
            {me.workspaces.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
        ) : (
          <div style={s("margin:8px 0 4px;padding:8px 10px;border:1px solid #1D221F;border-radius:8px;display:flex;flex-direction:column;gap:2px")}>
            <span style={s("font-size:13px;color:#E8ECE9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{workspace?.name}</span>
            <span style={s(`font-family:${MONO};font-size:10.5px;color:#6B736E`)}>{workspace?.role}</span>
          </div>
        )}

        <Btn onClick={() => dispatchEvent(new Event("verid:command-palette"))} css="display:flex;align-items:center;gap:8px;height:34px;margin:4px 0 12px;padding:0 10px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#7C847F;font-size:13px;cursor:pointer;text-align:left;transition:border-color .15s ease" hover="border-color:#303832;color:#9BA39E">
          <span>Search…</span>
          <span style={s(`margin-left:auto;font-family:${MONO};font-size:11px;padding:1px 6px;border:1px solid #303832;border-radius:4px`)}>⌘K</span>
        </Btn>

        {NAV.map((g, gi) => (
          <div key={gi} style={s("display:flex;flex-direction:column;gap:2px;margin-bottom:12px")}>
            {g.title && <div style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.1em;color:#6B736E;padding:12px 10px 6px`)}>{g.title}</div>}
            {g.items.map(([label, p]) => {
              const on = p === best;
              return (
                <A key={p} href={p} css={`display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:7px;background:${on ? "#151917" : "transparent"};color:${on ? "#E8ECE9" : "#9BA39E"};font-size:13.5px;transition:background .15s ease, color .15s ease`} hover="background:#151917;color:#E8ECE9">
                  <span style={s(`width:4px;height:4px;border-radius:50%;background:${on ? "#4ADE80" : "transparent"}`)} />
                  {label}
                </A>
              );
            })}
          </div>
        ))}

        <Btn onClick={async () => { await signOut(); router.push("/login"); }} css="margin-top:auto;display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:7px;border:0;background:transparent;color:#9BA39E;font-size:13.5px;cursor:pointer;text-align:left" hover="background:#151917;color:#E8ECE9">
          <span style={s("width:4px;height:4px")} />Sign out
        </Btn>
      </aside>

      <main style={s("flex:1;min-width:0")}>
        <div className="vd-top" style={s("position:sticky;top:0;z-index:10;height:52px;display:flex;align-items:center;gap:10px;padding:0 40px;border-bottom:1px solid #1A1F1C;background:rgba(11,13,12,0.85);backdrop-filter:blur(12px);font-size:13px")}>
          <button className="vd-menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)} style={s("width:34px;height:34px;align-items:center;justify-content:center;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;cursor:pointer;flex:none;font-size:16px")}>☰</button>
          <A href={`/${segs[0] ?? "overview"}`} css="color:#9BA39E">{TITLES[segs[0] ?? ""] ?? "Verid"}</A>
          {segs[1] && (<><span style={s("color:#3A443D")}>/</span><span style={s(`font-family:${MONO};font-size:12.5px;color:#E8ECE9;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`)}>{segs[1]}</span></>)}
          <div style={s("margin-left:auto;display:flex;align-items:center;gap:16px")}>
            <span className="vd-hide-sm"><NetworkPill /></span>
            <span title={me.user.email} style={s("width:28px;height:28px;border-radius:50%;background:#1D221F;border:1px solid #303832;display:grid;place-items:center;font-size:11px;color:#9BA39E;font-weight:500")}>{initials}</span>
          </div>
        </div>
        <div className="vd-content" style={s("max-width:1480px;margin:0 auto;padding:40px 40px 96px")}>{children}</div>
      </main>
    </div>
  );
}
