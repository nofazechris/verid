"use client";

/** Error raised for any non-2xx API response, carrying the server's stable error code. */
export class ApiClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
}

let currentWorkspace: string | undefined;
/** Set by the session provider; sent on every request as X-Verid-Workspace (the server re-checks membership). */
export function setApiWorkspace(id: string | undefined) {
  currentWorkspace = id;
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (currentWorkspace) headers["x-verid-workspace"] = currentWorkspace;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiClientError(0, "network_error", "Could not reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = json?.error;
    throw new ApiClientError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}

export const get = <T = any>(path: string, signal?: AbortSignal) => api<T>("GET", path, undefined, { signal });
export const post = <T = any>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T = any>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = <T = any>(path: string) => api<T>("DELETE", path);

/** Human-friendly message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong.";
}
