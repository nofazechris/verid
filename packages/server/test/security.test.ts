import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src";
import { client, createTestApp, makeAgent, runToAwaitingValidation, type Call, type TestApp } from "./harness";

let app: TestApp;
let call: Call;
let alice: { userId: string; workspaceId: string };
let bob: { userId: string; workspaceId: string };

beforeAll(async () => {
  app = await createTestApp();
  call = client(app);
  alice = await app.seedUser("alice@example.com", "alice-ws");
  bob = await app.seedUser("bob@example.com", "bob-ws");
}, 60_000);
afterAll(() => app.close());

const as = (u: { userId: string }) => ({ user: u.userId });

describe("authentication", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const r = await call("GET", "/agents");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("unauthenticated");
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("a malformed or unknown bearer token is 401 and does NOT fall back to a valid session", async () => {
    const r = await call("GET", "/agents", { ...as(alice), key: "verid_AAAAAAAA_" + "x".repeat(43) });
    expect(r.status).toBe(401);
    expect((await call("GET", "/agents", { ...as(alice), key: "garbage" })).status).toBe(401);
  });

  it("session auth + membership works; non-member workspace header is rejected", async () => {
    expect((await call("GET", "/agents", as(alice))).status).toBe(200);
    // Alice names Bob's workspace: must be refused even though it exists.
    const r = await call("GET", "/agents", { ...as(alice), workspace: bob.workspaceId });
    expect(r.status).toBe(403);
  });

  it("a user in several workspaces must say which one", async () => {
    const carol = await app.seedUser("carol@example.com", "carol-1");
    const { createWorkspace } = await import("../src");
    const second = await createWorkspace(app.deps.db, app.clock.now, carol.userId, { name: "Second", slug: "carol-2" });
    expect((await call("GET", "/agents", as(carol))).status).toBe(400);
    expect((await call("GET", "/agents", { ...as(carol), workspace: "carol-2" })).status).toBe(200);
    expect((await call("GET", "/workspace", { ...as(carol), workspace: second.id })).json.slug).toBe("carol-2");
  });
});

describe("CSRF protection for cookie sessions", () => {
  it("rejects unsafe requests with a missing or foreign Origin", async () => {
    const body = { slug: "csrf-agent", name: "X", version: "1" };
    expect((await call("POST", "/agents", { ...as(alice), body, origin: null })).status).toBe(403);
    expect((await call("POST", "/agents", { ...as(alice), body, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/agents", { ...as(alice), body })).status).toBe(201);
  });

  it("safe methods need no Origin; API-key requests are exempt (no ambient credentials)", async () => {
    expect((await call("GET", "/agents", as(alice))).status).toBe(200);
    const k = await call("POST", "/api-keys", { ...as(alice), body: { name: "ci" } });
    const r = await call("POST", "/agents", { key: k.json.key, body: { slug: "from-key", name: "K", version: "1" } });
    expect(r.status).toBe(201);
  });
});

describe("API keys", () => {
  it("returns the secret exactly once and never stores it", async () => {
    const created = await call("POST", "/api-keys", { ...as(alice), body: { name: "stored-check" } });
    expect(created.status).toBe(201);
    const key: string = created.json.key;
    expect(key).toMatch(/^verid_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/);

    const secret = key.split("_").slice(2).join("_");
    const [row] = await app.deps.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, created.json.id));
    expect(JSON.stringify(row)).not.toContain(secret); // only the hash is stored
    expect(row!.keyHash).toMatch(/^[0-9a-f]{64}$/);

    const listed = await call("GET", "/api-keys", as(alice));
    expect(listed.text).not.toContain(secret);
    expect(listed.text).not.toContain("keyHash");
    expect(listed.json.data.some((k: { id: string }) => k.id === created.json.id)).toBe(true);
  });

  it("is bound to its workspace and cannot see another's data", async () => {
    await makeAgent(call, as(bob), "bob-private-agent");
    const k = (await call("POST", "/api-keys", { ...as(alice), body: { name: "alice-key" } })).json.key;
    const list = await call("GET", "/agents", { key: k });
    expect(list.status).toBe(200);
    expect(list.text).not.toContain("bob-private-agent");
  });

  it("viewer keys are read-only; keys can never mint keys or become admin", async () => {
    const viewer = (await call("POST", "/api-keys", { ...as(alice), body: { name: "ro", role: "viewer" } })).json.key;
    expect((await call("GET", "/agents", { key: viewer })).status).toBe(200);
    expect((await call("POST", "/agents", { key: viewer, body: { slug: "nope", name: "N", version: "1" } })).status).toBe(403);

    const dev = (await call("POST", "/api-keys", { ...as(alice), body: { name: "dev" } })).json.key;
    expect((await call("POST", "/api-keys", { key: dev, body: { name: "child" } })).status).toBe(403);
    expect((await call("GET", "/api-keys", { key: dev })).status).toBe(403);
    // Asking for an elevated key role is rejected by validation.
    expect((await call("POST", "/api-keys", { ...as(alice), body: { name: "x", role: "admin" } })).status).toBe(400);
  });

  it("revoked and expired keys stop working immediately", async () => {
    const c = await call("POST", "/api-keys", { ...as(alice), body: { name: "temp", expiresInDays: 1 } });
    expect((await call("GET", "/agents", { key: c.json.key })).status).toBe(200);

    app.clock.advance(2 * 86_400_000); // past expiry
    expect((await call("GET", "/agents", { key: c.json.key })).status).toBe(401);

    const c2 = await call("POST", "/api-keys", { ...as(alice), body: { name: "revokable" } });
    expect((await call("GET", "/agents", { key: c2.json.key })).status).toBe(200);
    expect((await call("DELETE", `/api-keys/${c2.json.id}`, as(alice))).status).toBe(200);
    expect((await call("GET", "/agents", { key: c2.json.key })).status).toBe(401);
    expect((await call("DELETE", `/api-keys/${c2.json.id}`, as(alice))).status).toBe(404); // already revoked
  });

  it("a user cannot revoke another workspace's key", async () => {
    const bobKey = await call("POST", "/api-keys", { ...as(bob), body: { name: "bobs" } });
    expect((await call("DELETE", `/api-keys/${bobKey.json.id}`, as(alice))).status).toBe(404);
    expect((await call("GET", "/agents", { key: bobKey.json.key })).status).toBe(200);
  });
});

describe("workspace isolation (server-enforced)", () => {
  let aliceAgent: string, aliceExec: string, aliceReceipt: string;

  beforeAll(async () => {
    aliceAgent = await makeAgent(call, as(alice), "iso-agent");
    aliceExec = await runToAwaitingValidation(call, as(alice), aliceAgent);
    await call("POST", "/validations", { ...as(alice), body: { executionId: aliceExec, validatorId: "research-validator" } });
    aliceReceipt = (await call("POST", "/receipts", { ...as(alice), body: { executionId: aliceExec } })).json.receipt.receiptId;
  });

  it("another workspace gets 404 (never 403, never data) for every resource type", async () => {
    const attempts: Array<[string, string]> = [
      ["GET", `/agents/${aliceAgent}`],
      ["GET", `/executions/${aliceExec}`],
      ["GET", `/executions/${aliceExec}/evidence?includeContent=true`],
      ["GET", `/receipts/${aliceReceipt}`],
    ];
    for (const [m, p] of attempts) {
      const r = await call(m, p, as(bob));
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(r.text).not.toContain("Illustrative Startup");
    }
  });

  it("another workspace cannot mutate Alice's resources", async () => {
    expect((await call("PATCH", `/agents/${aliceAgent}`, { ...as(bob), body: { name: "pwned" } })).status).toBe(404);
    expect((await call("POST", `/executions/${aliceExec}/start`, as(bob))).status).toBe(404);
    expect((await call("POST", `/executions/${aliceExec}/evidence`, { ...as(bob), body: { type: "tool_call", content: {} } })).status).toBe(404);
    expect((await call("POST", `/executions/${aliceExec}/complete`, { ...as(bob), body: { result: [] } })).status).toBe(404);
    expect((await call("POST", "/validations", { ...as(bob), body: { executionId: aliceExec, validatorId: "research-validator" } })).status).toBe(404);
    expect((await call("POST", "/receipts", { ...as(bob), body: { executionId: aliceExec } })).status).toBe(404);
    expect((await call("POST", `/receipts/${aliceReceipt}/anchor`, as(bob))).status).toBe(404);
    expect((await call("GET", `/agents/${aliceAgent}`, as(alice))).json.agent.name).toBe("ResearchBot"); // untouched
  });

  it("cannot attach Alice's agent or policy to Bob's execution", async () => {
    const r = await call("POST", "/executions", { ...as(bob), body: { agentId: aliceAgent, task: { description: "x" } } });
    expect(r.status).toBe(400);
  });

  it("list endpoints only ever return the caller's rows", async () => {
    const bobAgent = await makeAgent(call, as(bob), "bob-iso");
    const aliceList = await call("GET", "/agents?limit=100", as(alice));
    const bobList = await call("GET", "/agents?limit=100", as(bob));
    expect(aliceList.json.data.some((a: { id: string }) => a.id === bobAgent)).toBe(false);
    expect(bobList.json.data.some((a: { id: string }) => a.id === aliceAgent)).toBe(false);
    expect((await call("GET", "/executions?limit=100", as(bob))).text).not.toContain(aliceExec);
    expect((await call("GET", "/receipts?limit=100", as(bob))).text).not.toContain(aliceReceipt);
  });

  it("IDs are opaque and unpredictable", () => {
    for (const id of [aliceAgent, aliceExec, aliceReceipt]) expect(id).toMatch(/^[a-z]+_[A-Za-z0-9_-]{22}$/);
    expect(aliceAgent).not.toBe(aliceExec);
  });
});

describe("roles are enforced on the server", () => {
  it("a viewer-role member can read but not write", async () => {
    const dave = await app.seedUser("dave@example.com", "dave-ws");
    // Demote dave to viewer directly (membership management API is a later feature).
    await app.deps.db.update(schema.workspaceMembers).set({ role: "viewer" }).where(eq(schema.workspaceMembers.userId, dave.userId));
    expect((await call("GET", "/agents", as(dave))).status).toBe(200);
    expect((await call("POST", "/agents", { ...as(dave), body: { slug: "v", name: "V", version: "1" } })).status).toBe(403);
    expect((await call("POST", "/api-keys", { ...as(dave), body: { name: "k" } })).status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("limits public endpoints per IP with Retry-After", async () => {
    const ip = "203.0.113.9";
    let last;
    for (let i = 0; i < 31; i++) last = await call("GET", "/network/status", { ip });
    expect(last!.status).toBe(429);
    expect(last!.json.error.code).toBe("rate_limited");
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different IP is unaffected; the window resets with time.
    expect((await call("GET", "/network/status", { ip: "203.0.113.10" })).status).toBe(200);
    app.clock.advance(61_000);
    expect((await call("GET", "/network/status", { ip })).status).toBe(200);
  });
});

describe("hardening", () => {
  it("returns stable JSON errors and security headers; never leaks internals", async () => {
    const r = await call("GET", "/nope", as(alice));
    expect(r.status).toBe(404);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-request-id")).toBeTruthy();
    expect((await call("POST", "/agents", { ...as(alice), rawBody: "{not json" })).status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const r = await call("POST", "/agents", { ...as(alice), rawBody: JSON.stringify({ slug: "big", name: "B", version: "1", description: "x".repeat(4 * 1024 * 1024) }) });
    expect(r.status).toBe(413);
  });
});
