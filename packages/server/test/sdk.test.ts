import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Verid, VeridError } from "../../sdk/src";
import { client, createTestApp, type Call, type TestApp } from "./harness";

/**
 * The SDK against the REAL API handler (no network): every call goes through createApi, auth, validation, the state
 * machine, the validators and the (fake) anchorer.
 */
let app: TestApp;
let call: Call;
let verid: Verid;
let me: { user: string };

beforeAll(async () => {
  app = await createTestApp();
  call = client(app);
  me = { user: (await app.seedUser("sdk@example.com", "sdk-ws")).userId };
  const key = (await call("POST", "/api-keys", { ...me, body: { name: "sdk", role: "developer" } })).json.key as string;
  verid = new Verid({
    apiKey: key,
    baseUrl: "https://verid.test",
    maxRetries: 0,
    fetch: (async (url: string, init: RequestInit) => app.handle(new Request(url, init))) as unknown as typeof fetch,
  });
}, 60_000);
afterAll(() => app.close());

const RULES = [
  { type: "items", path: "$", min: { param: "minimumResults", default: 2 } },
  { type: "required_fields", path: "$[*]", fields: ["name", "url"] },
  { type: "field_format", path: "$[*].url", format: "http_url" },
  { type: "evidence", types: ["tool_call", "tool_result"] },
];
const validator = { slug: "sdk-list", name: "SDK list", rules: RULES };
const task = { description: "list things", parameters: { minimumResults: 2 } };
const good = [{ name: "A", url: "https://a.example.com" }, { name: "B", url: "https://b.example.com" }];

describe("verid.run", () => {
  it("records tool calls as evidence, validates on the server, anchors, and returns links", async () => {
    const out = await verid.run({ agent: { slug: "sdk-bot", name: "SDK Bot", capabilities: ["x"] }, task, validator }, async (run) => {
      const found = await run.tool("search", { q: "things" }, async (i) => ({ q: i.q, hits: good }));
      await run.record("model_output", { note: "ranked" });
      return found.hits;
    });
    expect(out.status).toBe("pass");
    expect(out.anchored).toBe(true);
    expect(out.anchor).toMatchObject({ status: "confirmed" });
    expect(out.validatorId).toBe("custom:sdk-list");
    expect(out.checks.some((c) => !c.ok)).toBe(false);
    expect(out.proofUrl).toBe(`https://verid.test/proof/${out.receiptId}`);
    expect(out.executionUrl).toBe(`https://verid.test/executions/${out.executionId}`);

    const ev = (await call("GET", `/executions/${out.executionId}/evidence?includeContent=true`, me)).json.data as { type: string; content: { tool?: string; output?: unknown } }[];
    expect(ev.map((e) => e.type)).toEqual(["task", "tool_call", "tool_result", "model_output", "result"]);
    expect(ev[2]!.content).toMatchObject({ tool: "search" });
    expect((await call("GET", `/executions/${out.executionId}`, me)).json.execution.status).toBe("anchored");
  });

  it("a failing result is preserved: status fail, never anchored, with the reason in the checks", async () => {
    const out = await verid.run({ agent: "sdk-bot", task, validator: "custom:sdk-list" }, async (run) => {
      await run.tool("search", {}, async () => ({}));
      return [{ name: "A", url: "not-a-url" }];
    });
    expect(out.status).toBe("fail");
    expect(out.anchored).toBe(false);
    expect(out.anchorNote).toMatch(/can never be anchored/);
    expect(out.checks.some((c) => !c.ok && c.explanation?.includes("$[0].url"))).toBe(true); // names the exact offending value
    expect((await call("GET", `/executions/${out.executionId}`, me)).json.execution.status).toBe("validation_failed");
  });

  it("if the agent throws, the execution is marked failed with the reason and the error is rethrown", async () => {
    let id = "";
    await expect(
      verid.run({ agent: "sdk-bot", task, validator: "custom:sdk-list" }, async (run) => {
        id = run.executionId;
        await run.tool("flaky", {}, async () => {
          throw new Error("upstream 500");
        });
        return [];
      }),
    ).rejects.toThrow("upstream 500");
    const ex = (await call("GET", `/executions/${id}`, me)).json.execution;
    expect(ex).toMatchObject({ status: "failed", error: { code: "agent_error", message: "upstream 500" } });
    // the failed tool call itself was recorded, error included
    const ev = (await call("GET", `/executions/${id}/evidence?includeContent=true`, me)).json.data as { content: { error?: string } }[];
    expect(ev.at(-1)!.content.error).toBe("upstream 500");
  });

  it("the same runId resumes instead of duplicating (safe after a crash or retry)", async () => {
    const opts = { agent: "sdk-bot", task, validator: "custom:sdk-list", runId: "run-fixed-1" };
    const before = (await call("GET", "/executions?limit=100", me)).json.data.length;
    const first = await verid.run(opts, async (run) => (await run.tool("search", {}, async () => good)));
    const second = await verid.run(opts, async (run) => (await run.tool("search", {}, async () => good)));
    expect(second.executionId).toBe(first.executionId);
    expect(second.receiptId).toBe(first.receiptId);
    expect((await call("GET", "/executions?limit=100", me)).json.data.length).toBe(before + 1);
  });

  it("anchor:false skips anchoring; a server with no chain just reports it", async () => {
    const off = await verid.run({ agent: "sdk-bot", task, validator: "custom:sdk-list", anchor: false }, async (run) => run.tool("s", {}, async () => good));
    expect(off).toMatchObject({ status: "pass", anchored: false, anchorNote: "anchoring was turned off for this run" });

    const saved = app.deps.anchorer;
    app.deps.anchorer = undefined;
    const noChain = await verid.run({ agent: "sdk-bot", task, validator: "custom:sdk-list" }, async (run) => run.tool("s", {}, async () => good));
    app.deps.anchorer = saved;
    expect(noChain).toMatchObject({ status: "pass", anchored: false });
    expect(noChain.anchorNote).toMatch(/no chain configured/);
  });

  it("an oversized tool output is recorded as a truncated marker, not rejected", async () => {
    const big = "x".repeat(300_000);
    const out = await verid.run({ agent: "sdk-bot", task, validator: "custom:sdk-list", anchor: false }, async (run) => {
      await run.tool("big", {}, async () => ({ blob: big }));
      return good;
    });
    expect(out.status).toBe("pass");
    const ev = (await call("GET", `/executions/${out.executionId}/evidence?includeContent=true`, me)).json.data as { type: string; content: { output?: { truncated?: boolean } } }[];
    const res = ev.find((e) => e.type === "tool_result")!;
    expect(res.content.output ?? res.content).toMatchObject({ truncated: true });
  });

  it("a bad validator definition fails with every problem listed", async () => {
    const e = await verid.run({ agent: "sdk-bot", task, validator: { slug: "broken", name: "B", rules: [{ type: "nope" }] } }, async () => []).catch((x) => x);
    expect(e).toBeInstanceOf(VeridError);
    expect(e.validationErrors.length).toBeGreaterThan(0);
  });
});

describe("management helpers against the real API", () => {
  it("agents.ensure is idempotent; monitoring and delete behave as documented", async () => {
    const a = await verid.agents.ensure({ slug: "ensure-me", name: "Ensure Me" });
    const b = await verid.agents.ensure({ slug: "ensure-me" });
    expect(b.id).toBe(a.id);
    expect((await verid.agents.get(a.id)).monitoring).toMatchObject({ health: "no_runs" });
    await verid.agents.delete(a.id); // never ran: allowed
    await expect(verid.agents.get(a.id)).rejects.toMatchObject({ status: 404 });

    const used = await verid.agents.ensure({ slug: "sdk-bot" });
    await expect(verid.agents.delete(used.id)).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect((await verid.agents.update(used.id, { status: "inactive" })).status).toBe("inactive");
    await verid.agents.update(used.id, { status: "active" });
  });

  it("validators.test is a dry run and validators.update creates a new version", async () => {
    const t = await verid.validators.test({ rules: RULES, result: [{ name: "A", url: "nope" }], evidenceTypes: ["tool_call", "tool_result"] });
    expect(t.status).toBe("fail");
    const v2 = await verid.validators.update("sdk-list", { rules: [{ type: "items", path: "$", min: 1 }] });
    expect(v2.version).toBe(2);
  });
});
