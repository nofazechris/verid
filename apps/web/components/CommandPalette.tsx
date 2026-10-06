"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { s } from "@/lib/style";
import { get } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { MONO } from "./kit";

interface Item {
  label: string;
  sub: string;
  kind: string;
  run: () => void;
}

/** Open from anywhere with Ctrl/Cmd+K, or `verid:command-palette` (dispatched by the sidebar button). Signed-in only. */
export default function CommandPalette() {
  const router = useRouter();
  const { status, workspaceId, toast } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [found, setFound] = useState<Item[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const authed = status === "authed" && !!workspaceId;

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setIdx(0);
    setFound([]);
  }, []);
  const go = useCallback((path: string) => () => { router.push(path); close(); }, [router, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && authed) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") close();
    };
    const onOpen = () => authed && setOpen(true);
    addEventListener("keydown", onKey);
    addEventListener("verid:command-palette", onOpen);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("verid:command-palette", onOpen);
    };
  }, [authed, close]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 20);
  }, [open]);

  // Live search (debounced) against the real API.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setFound([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const [ex, ag] = await Promise.all([
          get<{ data: any[] }>(`/executions?q=${encodeURIComponent(term)}&limit=5`, ctl.signal),
          get<{ data: any[] }>("/agents?limit=100", ctl.signal),
        ]);
        const needle = term.toLowerCase();
        setFound([
          ...ex.data.map((e): Item => ({ label: e.taskDescription || e.id, sub: `${e.agentName} · ${e.status}`, kind: "Execution", run: go(`/executions/${e.id}`) })),
          ...ag.data
            .filter((a) => (a.name + " " + a.slug).toLowerCase().includes(needle))
            .slice(0, 4)
            .map((a): Item => ({ label: a.name, sub: `${a.slug} · v${a.version}`, kind: "Agent", run: go(`/agents/${a.id}`) })),
        ]);
      } catch {
        /* aborted or offline: keep the command list usable */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, open, go]);

  const commands = useMemo<Item[]>(
    () =>
      ([
        ["Overview", "Workspace summary", "/overview"],
        ["Executions", "All executions", "/executions"],
        ["Agents", "Registered agents", "/agents"],
        ["Receipts", "Portable receipts", "/receipts"],
        ["Get started", "Guided walkthrough: connect your first agent", "/get-started"],
        ["Settlements", "USDC escrows and their status", "/settlements"],
        ["Validators", "Validators and their rules", "/validators"],
        ["Policies", "Versioned policies", "/policies"],
        ["Verify a receipt", "Independent verification", "/verify"],
        ["API keys", "Create and revoke keys", "/settings/keys"],
        ["Documentation", "Quickstart and API", "/docs"],
      ] as [string, string, string][]).map(([label, sub, path]) => ({ label, sub, kind: "Go to", run: go(path) })).concat([
        { label: "Copy workspace ID", sub: workspaceId ?? "", kind: "Command", run: () => { void navigator.clipboard?.writeText(workspaceId ?? ""); toast("Workspace ID copied"); close(); } },
      ]),
    [go, workspaceId, toast, close],
  );

  const needle = q.trim().toLowerCase();
  const shownCommands = needle ? commands.filter((c) => (c.label + " " + c.sub).toLowerCase().includes(needle)) : commands;
  const flat = [...found, ...shownCommands];
  const cur = Math.min(idx, Math.max(flat.length - 1, 0));

  if (!open || !authed) return null;
  let k = 0;
  const row = (it: Item) => {
    const i = k++;
    return (
      <div key={it.kind + it.label + i} role="option" aria-selected={i === cur} onClick={it.run} onMouseEnter={() => setIdx(i)} style={s(`display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:8px;background:${i === cur ? "#1D221F" : "transparent"};cursor:pointer`)}>
        <span style={s("font-size:13.5px;color:#E8ECE9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.label}</span>
        <span style={s(`font-family:${MONO};font-size:11.5px;color:#7C847F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{it.sub}</span>
        <span style={s(`margin-left:auto;font-size:11.5px;color:${i === cur ? "#9BA39E" : "#6B736E"};flex:none`)}>{it.kind}</span>
      </div>
    );
  };

  return (
    <div onClick={close} style={s("position:fixed;inset:0;z-index:60;background:rgba(5,6,6,0.6);backdrop-filter:blur(4px);display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;animation:apFade .15s ease both")}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette" style={s("width:min(640px,92vw);background:#151917;border:1px solid #303832;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,0.6);overflow:hidden")}>
        <div style={s("display:flex;align-items:center;gap:12px;padding:0 16px;height:54px;border-bottom:1px solid #252B27")}>
          <span style={s("color:#7C847F;font-size:16px")}>⌕</span>
          <input
            ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Search executions and agents, or jump to a page…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx(Math.min(cur + 1, flat.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(Math.max(cur - 1, 0)); }
              else if (e.key === "Enter" && flat[cur]) flat[cur]!.run();
            }}
            style={s("flex:1;background:transparent;border:0;outline:none;color:#E8ECE9;font-size:15px")}
          />
          <span style={s(`font-family:${MONO};font-size:10.5px;padding:2px 6px;border:1px solid #303832;border-radius:4px;color:#7C847F`)}>ESC</span>
        </div>
        <div role="listbox" style={s("max-height:400px;overflow-y:auto;padding:6px 8px 8px")}>
          {found.length > 0 && (<><div style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.1em;color:#6B736E;padding:10px 12px 6px`)}>RESULTS</div>{found.map(row)}</>)}
          {shownCommands.length > 0 && (<><div style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.1em;color:#6B736E;padding:10px 12px 6px`)}>GO TO</div>{shownCommands.map(row)}</>)}
          {flat.length === 0 && <div style={s("padding:28px 12px;color:#9BA39E;font-size:13.5px")}>No results for “{q}”.</div>}
        </div>
        <div style={s(`display:flex;gap:16px;padding:10px 16px;border-top:1px solid #252B27;font-family:${MONO};font-size:11px;color:#6B736E`)}><span>↑↓ navigate</span><span>↵ open</span><span>⌘K toggle</span></div>
      </div>
    </div>
  );
}
