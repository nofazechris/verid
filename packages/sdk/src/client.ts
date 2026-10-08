import { VeridError, VeridNetworkError } from "./errors.js";
import type {
  Agent, Anchor, Check, EvidenceType, Execution, Json, Receipt, Settlement, Task, Validation, ValidatorDefinition, ValidatorInfo,
} from "./types.js";
import { Run, type RunOptions, type RunOutcome, type RunContext } from "./run.js";

export interface VeridOptions {
  /** A key from the dashboard (Settings → API Keys). Looks like `verid_xxxxxxxx_...`. Keep it server-side. */
  apiKey: string;
  /** Your Verid server: its origin (https://verid.example.com) or its API root (…/api/v1). */
  baseUrl: string;
  /** Override `fetch` (tests, proxies, older runtimes). Defaults to the global. */
  fetch?: typeof fetch;
  /** Per-request timeout. Default 30 000 ms. */
  timeoutMs?: number;
  /** Retries after a network error, 429, 502, 503 or 504. Default 3. Retries reuse the same idempotency key. */
  maxRetries?: number;
}

interface RequestOptions {
  idempotencyKey?: string;
  /** Statuses that should NOT throw (returned as-is in `.status`). */
  allow?: number[];
}

const RETRY_STATUS = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Random id that works in Node 18+, browsers and edge runtimes. */
export function uid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class Verid {
  readonly apiUrl: string;
  /** The dashboard origin, used to build links such as the public proof page. */
  readonly appUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: VeridOptions) {
    if (!opts.apiKey || !/^verid_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/.test(opts.apiKey)) {
      throw new Error("Verid: apiKey is missing or malformed. Create one in the dashboard under Settings → API Keys.");
    }
    if (!opts.baseUrl) throw new Error("Verid: baseUrl is required, e.g. https://your-verid-host.example");
    const root = opts.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    this.appUrl = root;
    this.apiUrl = `${root}/api/v1`;
    this.apiKey = opts.apiKey;
    const f = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) throw new Error("Verid: no fetch available. Use Node 18+ or pass { fetch }.");
    this.fetchImpl = f;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /** Build a client from `VERID_API_KEY` and `VERID_URL`. */
  static fromEnv(env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}): Verid {
    return new Verid({ apiKey: env.VERID_API_KEY ?? "", baseUrl: env.VERID_URL ?? "" });
  }

  // ------------------------------------------------------------------------------- transport

  /** Low-level request with retries. Prefer the typed methods below. */
  async request<T = unknown>(method: string, path: string, body?: unknown, o: RequestOptions = {}): Promise<T & { _status?: number }> {
    // One idempotency key per LOGICAL call, reused across retries, so a retry after a timeout can never duplicate.
    const idem = o.idempotencyKey ?? (method === "GET" || method === "DELETE" ? undefined : uid());
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(Math.min(8_000, 250 * 2 ** (attempt - 1)) + Math.random() * 100);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(this.apiUrl + path, {
          method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
            ...(idem ? { "idempotency-key": idem } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch (e) {
        lastErr = e;
        continue; // network error or timeout: retry
      } finally {
        clearTimeout(timer);
      }
      if (RETRY_STATUS.has(res.status) && attempt < this.maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) await sleep(Math.min(ra, 10) * 1000);
        lastErr = new VeridError(res.status, "retrying", `HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        /* non-JSON body */
      }
      if (!res.ok && !o.allow?.includes(res.status)) {
        const e = (json.error ?? {}) as { code?: string; message?: string; details?: unknown };
        throw new VeridError(res.status, e.code ?? "error", e.message ?? `Request failed (${res.status})`, e.details, res.headers.get("x-request-id") ?? undefined);
      }
      return { ...(json as T), _status: res.status } as T & { _status?: number };
    }
    throw new VeridNetworkError(`Could not reach Verid at ${this.apiUrl} after ${this.maxRetries + 1} attempts.`, lastErr);
  }

  // ----------------------------------------------------------------------------------- agents

  readonly agents = {
    /** Register an agent. Throws VeridError code "conflict" if the slug exists; see `ensure`. */
    create: async (a: { slug?: string; name: string; version: string; description?: string; capabilities?: string[] }): Promise<Agent> =>
      (await this.request<{ agent: Agent }>("POST", "/agents", a)).agent,
    /** Get the agent with this slug, creating it if it does not exist. Safe to call on every start-up. */
    ensure: async (a: { slug: string; name?: string; version?: string; description?: string; capabilities?: string[] }): Promise<Agent> => {
      try {
        return await this.agents.create({ slug: a.slug, name: a.name ?? a.slug, version: a.version ?? "1.0.0", description: a.description, capabilities: a.capabilities });
      } catch (e) {
        if (!(e instanceof VeridError) || e.status !== 409) throw e;
        const found = await this.agents.findBySlug(a.slug);
        if (!found) throw e;
        return found;
      }
    },
    findBySlug: async (slug: string): Promise<Agent | undefined> => (await this.agents.list()).find((x) => x.slug === slug),
    list: async (): Promise<Agent[]> => (await this.request<{ data: Agent[] }>("GET", "/agents?limit=100")).data,
    /** Includes `monitoring`: health, pass rate, a 14-day series, the last failure. */
    get: async (id: string): Promise<Agent> => (await this.request<{ agent: Agent }>("GET", `/agents/${id}`)).agent,
    update: async (id: string, patch: { name?: string; description?: string; version?: string; capabilities?: string[]; status?: "active" | "inactive" }): Promise<Agent> =>
      (await this.request<{ agent: Agent }>("PATCH", `/agents/${id}`, patch)).agent,
    /** Only works for an agent that has never run; otherwise archive it with update({ status: "inactive" }). */
    delete: async (id: string): Promise<void> => void (await this.request("DELETE", `/agents/${id}`)),
  };

  // ------------------------------------------------------------------------------- validators

  readonly validators = {
    list: async (): Promise<ValidatorInfo[]> => (await this.request<{ data: ValidatorInfo[] }>("GET", "/validators")).data,
    /** Create a rule-based validator (version 1). Use it as `custom:<slug>`. */
    create: async (v: ValidatorDefinition): Promise<ValidatorInfo> => (await this.request<{ validator: ValidatorInfo }>("POST", "/validators", v)).validator,
    /**
     * Make the server's validator match the rules in your code. Safe to call on every start-up or run:
     *  - new slug                      -> creates version 1
     *  - these exact rules already exist -> creates nothing
     *  - you changed the rules         -> creates version N+1
     * Returns the id to validate with, pinned to the matching version (`custom:<slug>@<n>`), so a deployment that is
     * still running older rules keeps using them instead of flipping the validator back. Only the rules count: a
     * new name or description does not create a version. Earlier versions, and every verdict they produced, never change.
     */
    ensure: async (v: ValidatorDefinition): Promise<string> => {
      const { validator } = await this.request<{ validator: ValidatorInfo; action: "created" | "unchanged" | "versioned" }>("POST", "/validators/ensure", v);
      return `custom:${v.slug}@${validator.version}`;
    },
    /** Create version N+1 (earlier versions never change). */
    update: async (slug: string, patch: { name?: string; description?: string; rules?: unknown[] }): Promise<ValidatorInfo> =>
      (await this.request<{ validator: ValidatorInfo }>("PATCH", `/validators/${slug}`, patch)).validator,
    /** Dry-run rules against a sample. Nothing is stored. */
    test: async (t: { rules: unknown[]; result: unknown; evidenceTypes?: string[]; taskParameters?: Record<string, unknown> }): Promise<{ status: string; checks: Check[] }> =>
      this.request("POST", "/validators/test", t),
  };

  // ------------------------------------------------------------------------------- executions

  readonly executions = {
    create: async (e: { agentId: string; task: Task; policyId?: string }, idempotencyKey?: string): Promise<Execution> =>
      (await this.request<{ execution: Execution }>("POST", "/executions", e, { idempotencyKey })).execution,
    start: async (id: string): Promise<Execution> => (await this.request<{ execution: Execution }>("POST", `/executions/${id}/start`)).execution,
    addEvidence: async (id: string, type: EvidenceType, content: Json | unknown, idempotencyKey?: string): Promise<{ id: string; sequenceNumber: number; contentHash: string }> =>
      (await this.request<{ evidence: { id: string; sequenceNumber: number; contentHash: string } }>("POST", `/executions/${id}/evidence`, { type, content }, { idempotencyKey })).evidence,
    complete: async (id: string, result: Json | unknown, idempotencyKey?: string): Promise<Execution> =>
      (await this.request<{ execution: Execution }>("POST", `/executions/${id}/complete`, { result }, { idempotencyKey })).execution,
    /** Record that the AGENT crashed or gave up (not a failed validation). Terminal. */
    fail: async (id: string, reason: string): Promise<Execution> => (await this.request<{ execution: Execution }>("POST", `/executions/${id}/fail`, { reason })).execution,
    get: async (id: string): Promise<Execution> => (await this.request<{ execution: Execution }>("GET", `/executions/${id}`)).execution,
  };

  // ---------------------------------------------------------------- validation, receipts, anchoring

  readonly validations = {
    /** Run a validator on the server. You cannot supply the outcome. */
    run: async (executionId: string, validatorId: string, idempotencyKey?: string): Promise<{ validation: Validation; executionStatus: string }> =>
      this.request("POST", "/validations", { executionId, validatorId }, { idempotencyKey }),
  };

  readonly receipts = {
    create: async (executionId: string): Promise<Receipt> => (await this.request<{ receipt: Receipt }>("POST", "/receipts", { executionId })).receipt,
    /** Anchor on Arc. Returns `confirmed: false` while the transaction is pending; call again to re-check. */
    anchor: async (receiptId: string): Promise<{ confirmed: boolean; anchor: Anchor | null; pending: boolean }> => {
      const r = await this.request<{ anchor: Anchor | null; _status?: number }>("POST", `/receipts/${receiptId}/anchor`, undefined, { allow: [202] });
      return { confirmed: r.anchor?.status === "confirmed", anchor: r.anchor ?? null, pending: r._status === 202 };
    },
    get: async (id: string): Promise<{ receipt: Receipt; anchor: Anchor | null }> => this.request("GET", `/receipts/${id}`),
    /** The public, no-login proof page for a receipt. */
    proofUrl: (receiptId: string): string => `${this.appUrl}/proof/${receiptId}`,
  };

  // ---------------------------------------------------------------------------------- settlement

  readonly settlements = {
    get: async (executionId: string): Promise<Record<string, unknown>> => this.request("GET", `/executions/${executionId}/settlement`),
    /** Link an escrow the payer already funded on-chain. Everything is read from the chain. */
    register: async (executionId: string): Promise<Settlement> => (await this.request<{ settlement: Settlement }>("POST", `/executions/${executionId}/settlement`)).settlement,
    /** Release or refund, whichever the contract allows. */
    settle: async (executionId: string): Promise<{ settlement: Settlement; executionStatus: string; pending?: boolean }> =>
      this.request("POST", `/executions/${executionId}/settle`, undefined, { allow: [202] }),
  };

  executionUrl(executionId: string): string {
    return `${this.appUrl}/executions/${executionId}`;
  }

  // ------------------------------------------------------------------------------------------ run

  /**
   * Run `fn` as a recorded, validated, (optionally) anchored execution. This is the one call most agents need:
   *
   *   const out = await verid.run({ agent: "my-agent", task, validator: "custom:my-checker" }, async (run) => {
   *     const hits = await run.tool("search", { q }, () => search(q));   // recorded as tool_call + tool_result
   *     return hits.map(toEntry);                                         // the result to validate
   *   });
   *
   * If `fn` throws, the execution is marked failed (with the reason) and the error is rethrown.
   */
  run<T extends Json | unknown>(opts: RunOptions, fn: (ctx: RunContext) => Promise<T>): Promise<RunOutcome<T>> {
    return new Run(this, opts).execute(fn);
  }
}
