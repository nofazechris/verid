"use client";

import { signOut as nextAuthSignOut } from "next-auth/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClientError, get, setApiWorkspace } from "./api";

export interface Me {
  user: { userId: string; email: string; emailVerified: boolean };
  workspaces: { id: string; name: string; slug: string; role: "owner" | "admin" | "developer" | "viewer" }[];
}

type Status = "loading" | "anon" | "authed";

interface SessionCtx {
  status: Status;
  me: Me | null;
  workspaceId: string | undefined;
  workspace: Me["workspaces"][number] | undefined;
  setWorkspace: (id: string) => void;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  toast: (message: string) => void;
}

const Ctx = createContext<SessionCtx | null>(null);
const WS_KEY = "verid.workspace";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined);
  const [toastMsg, setToastMsg] = useState<{ text: string; on: boolean }>({ text: "", on: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const choose = useCallback((m: Me) => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(WS_KEY);
    } catch {
      /* storage unavailable */
    }
    const id = m.workspaces.find((w) => w.id === saved)?.id ?? m.workspaces[0]?.id;
    setApiWorkspace(id);
    setWorkspaceId(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await get<Me>("/me");
      setMe(m);
      choose(m);
      setStatus("authed");
      return m;
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        setMe(null);
        setApiWorkspace(undefined);
        setWorkspaceId(undefined);
        setStatus("anon");
        return null;
      }
      // Transient failure: stay in the previous state rather than logging the user out.
      setStatus((s) => (s === "loading" ? "anon" : s));
      return null;
    }
  }, [choose]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setWorkspace = useCallback((id: string) => {
    try {
      localStorage.setItem(WS_KEY, id);
    } catch {
      /* ignore */
    }
    setApiWorkspace(id);
    setWorkspaceId(id);
  }, []);

  const toast = useCallback((text: string) => {
    clearTimeout(timer.current);
    setToastMsg({ text, on: true });
    timer.current = setTimeout(() => setToastMsg((t) => ({ ...t, on: false })), 2400);
  }, []);

  const signOut = useCallback(async () => {
    await nextAuthSignOut({ redirect: false });
    setMe(null);
    setApiWorkspace(undefined);
    setWorkspaceId(undefined);
    setStatus("anon");
  }, []);

  const value = useMemo<SessionCtx>(
    () => ({ status, me, workspaceId, workspace: me?.workspaces.find((w) => w.id === workspaceId), setWorkspace, refresh, signOut, toast }),
    [status, me, workspaceId, setWorkspace, refresh, signOut, toast],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "fixed", left: "50%", bottom: 28, zIndex: 70, pointerEvents: "none", height: 38, display: "flex", alignItems: "center",
          padding: "0 16px", borderRadius: 9, background: "#1D221F", border: "1px solid #303832", boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          fontSize: 13, color: "#E8ECE9", whiteSpace: "nowrap", opacity: toastMsg.on ? 1 : 0,
          transform: `translateX(-50%) translateY(${toastMsg.on ? 0 : 8}px)`, transition: "opacity .2s ease, transform .2s ease",
        }}
      >
        {toastMsg.text}
      </div>
    </Ctx.Provider>
  );
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}

const RANK = { viewer: 0, developer: 1, admin: 2, owner: 3 } as const;
/** UI-only convenience for hiding buttons. The SERVER enforces roles; this never grants anything. */
export function useCan(min: keyof typeof RANK): boolean {
  const { workspace } = useSession();
  return !!workspace && RANK[workspace.role] >= RANK[min];
}
