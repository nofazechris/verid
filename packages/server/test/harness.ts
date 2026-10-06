import type { Hex32 } from "@verid/core";
import { createApi, createPgliteDb, createWorkspace, ensureUser, MemoryMailer, MemoryRateLimiter, type AnchorSubmitResult, type Anchorer, type DbHandle, type Deps } from "../src";

export const ORIGIN = "https://app.test";
export const APP_URL = "https://app.test";

export interface FakeAnchorer extends Anchorer {
  calls: number;
  /** Next outcome(s); the last one repeats. May be an Error to simulate an RPC failure. */
  script: Array<AnchorSubmitResult | Error>;
}

export function fakeAnchorer(): FakeAnchorer {
  const a: FakeAnchorer = {
    target: { network: "local-test", chainId: 31337, registryAddress: "0x1111111111111111111111111111111111111111" },
    calls: 0,
    script: [{ status: "confirmed", txHash: `0x${"ab".repeat(32)}` as Hex32, blockNumber: 7 }],
    async submit() {
      a.calls++;
      const next = a.script.length > 1 ? a.script.shift()! : a.script[0]!;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return a;
}

export interface TestApp {
  handle: (req: Request) => Promise<Response>;
  deps: Deps;
  handle_: DbHandle;
  anchorer: FakeAnchorer;
  mailer: MemoryMailer;
  clock: { now: Date; advance(ms: number): void };
  close: () => Promise<void>;
  /** Create a user + their own workspace; returns ids. */
  seedUser(email: string, slug: string): Promise<{ userId: string; workspaceId: string }>;
}

export async function createTestApp(overrides: Partial<Deps> = {}): Promise<TestApp> {
  const handle_ = await createPgliteDb();
  const clock = { now: new Date("2026-10-01T12:00:00.000Z"), advance(ms: number) { clock.now = new Date(clock.now.getTime() + ms); } };
  const anchorer = fakeAnchorer();
  const mailer = new MemoryMailer();
  const deps: Deps = {
    db: handle_.db,
    now: () => clock.now,
    limiter: new MemoryRateLimiter(() => clock.now.getTime()),
    allowedOrigins: [ORIGIN],
    mailer,
    appUrl: APP_URL,
    scryptN: 1024, // fast hashing for tests; production uses the default (32768)
    // Test session scheme: header "x-test-user: <userId>" stands in for a cookie session.
    sessions: async (req) => {
      const u = req.headers.get("x-test-user");
      return u ? { userId: u } : null;
    },
    anchorer,
    ...overrides,
  };
  const handle = createApi(deps);
  return {
    handle, deps, handle_, anchorer, mailer, clock,
    close: () => handle_.close(),
    async seedUser(email, slug) {
      const u = await ensureUser(handle_.db, clock.now, { email, name: email.split("@")[0], emailVerified: true });
      const ws = await createWorkspace(handle_.db, clock.now, u.id, { name: `${slug} workspace`, slug });
      return { userId: u.id, workspaceId: ws.id };
    },
  };
}

export interface CallOpts {
  body?: unknown;
  /** Act as this user via cookie-session emulation (adds a valid Origin for unsafe methods). */
  user?: string;
  workspace?: string;
  /** Act as this API key. */
  key?: string;
  idem?: string;
  origin?: string | null;
  headers?: Record<string, string>;
  ip?: string;
  rawBody?: string;
}

export function client(app: TestApp) {
  return async function call(method: string, path: string, o: CallOpts = {}) {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.key) headers.authorization = `Bearer ${o.key}`;
    if (o.user) {
      headers["x-test-user"] = o.user;
      if (method !== "GET") {
        const origin = o.origin === undefined ? ORIGIN : o.origin;
        if (origin) headers.origin = origin;
      }
    }
    if (o.workspace) headers["x-verid-workspace"] = o.workspace;
    if (o.idem) headers["idempotency-key"] = o.idem;
    if (o.ip) headers["x-forwarded-for"] = o.ip;
    const hasBody = o.body !== undefined || o.rawBody !== undefined;
    if (hasBody) headers["content-type"] = "application/json";
    const res = await app.handle(
      new Request(`http://localhost/api/v1${path}`, { method, headers, body: hasBody ? (o.rawBody ?? JSON.stringify(o.body)) : undefined }),
    );
    const text = await res.text();
    let json: any = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, json, headers: res.headers, text };
  };
}
export type Call = ReturnType<typeof client>;

/** Good research results (illustrative fixture; example domains). */
export const goodResult = (n = 10) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Illustrative Startup ${i + 1}`,
    website: `https://illustrative-startup-${i + 1}.example.com`,
    foundedYear: 2025,
    sources: [`https://directory.example.org/listing/${i + 1}`],
  }));

export const researchTask = {
  description: "Find 10 AI startups founded after 2024.",
  parameters: { foundedAfter: 2024, minimumResults: 10 },
};

/** Drive one execution through create -> start -> evidence -> complete. */
export async function runToAwaitingValidation(call: Call, as: { user: string; workspace?: string }, agentId: string, n = 10) {
  const created = await call("POST", "/executions", { ...as, body: { agentId, task: researchTask } });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.json)}`);
  const id = created.json.execution.id as string;
  await call("POST", `/executions/${id}/start`, as);
  await call("POST", `/executions/${id}/evidence`, { ...as, body: { type: "tool_call", content: { tool: "search", q: "x" } } });
  await call("POST", `/executions/${id}/evidence`, { ...as, body: { type: "tool_result", content: { results: goodResult(n) } } });
  const done = await call("POST", `/executions/${id}/complete`, { ...as, body: { result: goodResult(n) } });
  if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.json)}`);
  return id;
}

export async function makeAgent(call: Call, as: { user: string; workspace?: string }, slug = "researchbot") {
  const r = await call("POST", "/agents", { ...as, body: { slug, name: "ResearchBot", version: "1.0.0", capabilities: ["web.search"] } });
  if (r.status !== 201) throw new Error(`agent failed: ${JSON.stringify(r.json)}`);
  return r.json.agent.id as string;
}
