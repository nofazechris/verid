"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, get } from "./api";
import { useSession } from "./session";

export interface Query<T> {
  data: T | undefined;
  error: ApiClientError | Error | undefined;
  loading: boolean;
  reload: () => void;
}

interface State<T> {
  key: string;
  data?: T;
  error?: Query<T>["error"];
  loading: boolean;
}

/**
 * GET `path` into state. Pass `null` to skip. Re-fetches when the path or the active workspace
 * changes (clearing old data so another page's results never flash); `reload()` and `pollMs`
 * refresh in the background WITHOUT clearing, so the UI doesn't flicker. Stale responses are
 * aborted.
 */
export function useApi<T = any>(path: string | null, opts: { pollMs?: number } = {}): Query<T> {
  const { workspaceId } = useSession();
  const key = `${workspaceId ?? ""}|${path ?? ""}`;
  const [state, setState] = useState<State<T>>({ key, loading: path !== null });
  const [tick, setTick] = useState(0);
  const lastKey = useRef(key);

  useEffect(() => {
    if (path === null) {
      setState({ key, loading: false });
      return;
    }
    const keyChanged = lastKey.current !== key;
    lastKey.current = key;
    const ctl = new AbortController();
    if (keyChanged || state.key !== key) setState({ key, loading: true });
    get<T>(path, ctl.signal)
      .then((data) => setState({ key, data, loading: false }))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: e as Error, loading: false }));
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  useEffect(() => {
    if (!opts.pollMs || path === null) return;
    const id = setInterval(() => setTick((t) => t + 1), opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, path]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = state.key === key ? state : { key, loading: path !== null };
  return { data: current.data, error: current.error, loading: current.loading, reload };
}
