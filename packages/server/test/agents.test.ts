import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createTestApp, makeAgent, runToAwaitingValidation, type Call, type TestApp } from "./harness";

let app: TestApp;
let call: Call;
let me: { user: string };

beforeAll(async () => {
  app = await createTestApp();
  call = client(app);
  me = { user: (await app.seedUser("agents@example.com", "agents-ws")).userId };
}, 60_000);
afterAll(() => app.close());

const agentWithSlug = async (slug: string, as: { user: string } = me) => makeAgent(call, as, slug);
const monitoring = async (id: string) => (await call("GET", `/agents/${id}`, me)).json.agent.monitoring;

/** One finished run: pass (validated) or fail (validation failed with 6 of 10). */
async function finishedRun(agentId: string, pass: boolean) {
  app.clock.advance(60_000);
  const ex = await runToAwaitingValidation(call, me, agentId, pass ? 10 : 6);
  await call("POST", "/validations", { ...me, body: { executionId: ex, validatorId: "research-validator" } });
  return ex;
}
async function crashedRun(agentId: string, reason = "tool timed out") {
  app.clock.advance(60_000);
  const created = await call("POST", "/executions", { ...me, body: { agentId, task: { description: "t" } } });
  const id = created.json.execution.id as string;
  await call("POST", `/executions/${id}/start`, me);
  const r = await call("POST", `/executions/${id}/fail`, { ...me, body: { reason } });
  return { id, r };
}

describe("marking an execution failed (the agent crashed)", () => {
  it("is terminal, keeps the reason, and is not a validation", async () => {
    const a = await agentWithSlug("crashy");
    const { id, r } = await crashedRun(a);
    expect(r.status).toBe(200);
    expect(r.json.execution).toMatchObject({ status: "failed", error: { code: "agent_error", message: "tool timed out" } });
    // terminal: nothing can move it
    expect((await call("POST", `/executions/${id}/start`, me)).status).toBe(409);
    expect((await call("POST", `/executions/${id}/fail`, { ...me, body: { reason: "again" } })).status).toBe(409);
    expect((await call("GET", `/executions/${id}`, me)).json.execution.validation).toBeNull();
  });

  it("only works before validation, needs a reason, and respects roles and workspaces", async () => {
    const a = await agentWithSlug("fail-rules");
    const validated = await runToAwaitingValidation(call, me, a);
    await call("POST", "/validations", { ...me, body: { executionId: validated, validatorId: "research-validator" } });
    expect((await call("POST", `/executions/${validated}/fail`, { ...me, body: { reason: "x" } })).status).toBe(409);

    const created = await call("POST", "/executions", { ...me, body: { agentId: a, task: { description: "t" } } });
    const id = created.json.execution.id as string;
    expect((await call("POST", `/executions/${id}/fail`, { ...me, body: {} })).status).toBe(400);
    const viewer = (await call("POST", "/api-keys", { ...me, body: { name: "ro", role: "viewer" } })).json.key;
    expect((await call("POST", `/executions/${id}/fail`, { key: viewer, body: { reason: "x" } })).status).toBe(403);
    const other = { user: (await app.seedUser("agents-other@example.com", "agents-other")).userId };
    expect((await call("POST", `/executions/${id}/fail`, { ...other, body: { reason: "x" } })).status).toBe(404);
    expect((await call("POST", `/executions/${id}/fail`, { ...me, body: { reason: "gave up" } })).status).toBe(200);
  });
});

describe("deleting agents", () => {
  it("deletes an agent that never ran, and refuses (with an archive hint) once it has history", async () => {
    const fresh = await agentWithSlug("never-ran");
    expect((await call("DELETE", `/agents/${fresh}`, me)).status).toBe(200);
    expect((await call("GET", `/agents/${fresh}`, me)).status).toBe(404);

    const used = await agentWithSlug("has-history");
    await crashedRun(used);
    const r = await call("DELETE", `/agents/${used}`, me);
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/permanent record/);
    expect(r.json.error.details).toMatchObject({ executions: 1, archive: true });
    // archiving keeps the history
    expect((await call("PATCH", `/agents/${used}`, { ...me, body: { status: "inactive" } })).json.agent.status).toBe("inactive");
    expect((await call("GET", `/agents/${used}`, me)).status).toBe(200);
  });

  it("is developer-only and workspace-scoped", async () => {
    const a = await agentWithSlug("del-rules");
    const viewer = (await call("POST", "/api-keys", { ...me, body: { name: "ro2", role: "viewer" } })).json.key;
    expect((await call("DELETE", `/agents/${a}`, { key: viewer })).status).toBe(403);
    const other = { user: (await app.seedUser("agents-other2@example.com", "agents-other2")).userId };
    expect((await call("DELETE", `/agents/${a}`, other)).status).toBe(404);
    expect((await call("GET", `/agents/${a}`, me)).status).toBe(200); // still there
  });
});

describe("agent monitoring", () => {
  it("starts as no_runs, then reports real counts, the series and the last failure", async () => {
    const a = await agentWithSlug("watched");
    expect(await monitoring(a)).toMatchObject({ health: "no_runs", recentRuns: 0, lastRunAt: null, stuckRuns: 0 });

    await finishedRun(a, true);
    await finishedRun(a, true);
    await crashedRun(a, "upstream 500");
    const m = await monitoring(a);
    expect(m.recentRuns).toBe(3);
    expect(m.last24h).toBe(3);
    expect(m.byStatus).toMatchObject({ validated: 2, failed: 1 });
    expect(m.series).toHaveLength(14);
    expect(m.series.reduce((n: number, d: { total: number }) => n + d.total, 0)).toBe(3);
    expect(m.lastFailure).toMatchObject({ kind: "agent_error", message: "upstream 500" });
    expect(m.recent[0]).toMatchObject({ status: "failed", error: "upstream 500" }); // newest first
    expect(m.avgDurationSeconds).not.toBeUndefined();
  });

  it("health: failing after 3 straight failures, degraded below 80%, healthy otherwise", async () => {
    const failing = await agentWithSlug("health-failing");
    await finishedRun(failing, true);
    await finishedRun(failing, false);
    await crashedRun(failing);
    expect((await monitoring(failing)).health).not.toBe("failing"); // only 2 bad in a row so far
    await finishedRun(failing, false);
    const f = await monitoring(failing);
    expect(f.health).toBe("failing");
    expect(f.healthReason).toMatch(/last 3/);

    const degraded = await agentWithSlug("health-degraded");
    for (const pass of [true, true, true, true, true, false, true, false, true, false]) await finishedRun(degraded, pass);
    const d = await monitoring(degraded);
    expect(d.health).toBe("degraded"); // 7 of the last 10 = 70%
    expect(d.recentPassRate).toBeCloseTo(0.7);

    const healthy = await agentWithSlug("health-healthy");
    for (let i = 0; i < 4; i++) await finishedRun(healthy, true);
    expect((await monitoring(healthy)).health).toBe("healthy");
  });

  it("with very few runs, a single failure is flagged honestly instead of reading as healthy", async () => {
    const a = await agentWithSlug("few-runs");
    await finishedRun(a, true);
    expect((await monitoring(a)).health).toBe("healthy");
    await crashedRun(a, "boom");
    const m = await monitoring(a);
    expect(m.health).toBe("degraded");
    expect(m.healthReason).toMatch(/1 of 2 finished runs failed so far/);
  });

  it("flags runs that started but never progressed (a hung agent)", async () => {
    const a = await agentWithSlug("hangs");
    const created = await call("POST", "/executions", { ...me, body: { agentId: a, task: { description: "t" } } });
    await call("POST", `/executions/${created.json.execution.id}/start`, me);
    expect((await monitoring(a)).stuckRuns).toBe(0);
    app.clock.advance(2 * 60 * 60 * 1000);
    expect((await monitoring(a)).stuckRuns).toBe(1);
  });

  it("the list carries a compact summary per agent, and other workspaces see nothing of it", async () => {
    const list = (await call("GET", "/agents?limit=100", me)).json.data as { slug: string; monitoring: { health: string } }[];
    expect(list.find((x) => x.slug === "watched")!.monitoring.health).toBeDefined();
    expect(list.find((x) => x.slug === "watched")!.monitoring).not.toHaveProperty("series"); // detail only
    const other = { user: (await app.seedUser("agents-other3@example.com", "agents-other3")).userId };
    expect((await call("GET", "/agents", other)).json.data).toEqual([]);
  });
});

describe("onboarding progress (drives the getting-started walkthrough)", () => {
  it("starts empty and only ticks steps that really happened, per workspace", async () => {
    const owner = { user: (await app.seedUser("onb@example.com", "onb-ws")).userId };
    const empty = (await call("GET", "/onboarding", owner)).json;
    expect(empty).toMatchObject({ apiKeys: 0, agents: 0, customValidators: 0, executions: 0, passed: 0, anchored: 0, escrows: 0, latestExecution: null, chainConfigured: true });

    const key = (await call("POST", "/api-keys", { ...owner, body: { name: "k", role: "developer" } })).json.key;
    const agent = (await call("POST", "/agents", { key, body: { slug: "onb-bot", name: "Onb", version: "1" } })).json.agent.id;
    await call("POST", "/validators", { key, body: { slug: "onb-check", name: "C", rules: [{ type: "items", path: "$", min: 1 }] } });
    const created = await call("POST", "/executions", { key, body: { agentId: agent, task: { description: "t" } } });
    await call("POST", `/executions/${created.json.execution.id}/start`, { key });
    const mid = (await call("GET", "/onboarding", owner)).json;
    expect(mid).toMatchObject({ apiKeys: 1, agents: 1, customValidators: 1, executions: 1, passed: 0, anchored: 0 });
    expect(mid.latestExecution).toMatchObject({ id: created.json.execution.id, status: "running" });

    // revoking the key un-ticks it
    const keyId = (await call("GET", "/api-keys", owner)).json.data[0].id;
    await call("DELETE", `/api-keys/${keyId}`, owner);
    expect((await call("GET", "/onboarding", owner)).json.apiKeys).toBe(0);

    // another workspace sees none of it
    const other = { user: (await app.seedUser("onb-other@example.com", "onb-other")).userId };
    expect((await call("GET", "/onboarding", other)).json).toMatchObject({ apiKeys: 0, agents: 0, executions: 0 });
  });
});
