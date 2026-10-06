import { describe, expect, it, vi } from "vitest";
import { Verid, VeridError, VeridNetworkError } from "../src";

const KEY = "verid_AbCdEfGh_" + "x".repeat(43);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(responses: Array<Response | Error>, opts: { maxRetries?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    if (next instanceof Error) throw next;
    return next.clone();
  });
  return { v: new Verid({ apiKey: KEY, baseUrl: "https://verid.test", fetch: f as unknown as typeof fetch, maxRetries: 2, ...opts }), calls, f };
}

describe("construction", () => {
  it("normalises the base URL and rejects a missing or malformed key", () => {
    for (const base of ["https://verid.test", "https://verid.test/", "https://verid.test/api/v1", "https://verid.test/api/v1/"]) {
      const v = new Verid({ apiKey: KEY, baseUrl: base, fetch: (async () => json(200, {})) as unknown as typeof fetch });
      expect(v.apiUrl).toBe("https://verid.test/api/v1");
      expect(v.appUrl).toBe("https://verid.test");
    }
    expect(() => new Verid({ apiKey: "", baseUrl: "https://x.test" })).toThrow(/apiKey/);
    expect(() => new Verid({ apiKey: "sk_live_nope", baseUrl: "https://x.test" })).toThrow(/malformed/);
    expect(() => new Verid({ apiKey: KEY, baseUrl: "" })).toThrow(/baseUrl/);
  });

  it("fromEnv reads VERID_API_KEY and VERID_URL", () => {
    const v = Verid.fromEnv({ VERID_API_KEY: KEY, VERID_URL: "https://env.test/api/v1" });
    expect(v.apiUrl).toBe("https://env.test/api/v1");
    expect(() => Verid.fromEnv({})).toThrow();
  });
});

describe("requests", () => {
  it("sends the bearer key and an idempotency key on writes, none on reads", async () => {
    const { v, calls } = client([json(200, { data: [] })]);
    await v.agents.list();
    await v.executions.create({ agentId: "agt_1", task: { description: "t" } }).catch(() => undefined);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect((calls[0]!.init.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
    expect((calls[1]!.init.headers as Record<string, string>)["idempotency-key"]).toMatch(/\S{8,}/);
  });

  it("retries a network error and a 503, reusing the SAME idempotency key, then succeeds", async () => {
    const { v, calls } = client([new TypeError("fetch failed"), json(503, { error: { code: "unavailable", message: "x" } }), json(201, { agent: { id: "agt_1", slug: "a" } })]);
    const a = await v.agents.create({ name: "A", version: "1" });
    expect(a.id).toBe("agt_1");
    expect(calls).toHaveLength(3);
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)["idempotency-key"]);
    expect(new Set(keys).size).toBe(1);
  });

  it("does not retry client errors, and surfaces code, status, details and request id", async () => {
    const { v, calls } = client([json(400, { error: { code: "invalid_request", message: "the rules are not valid", details: { errors: ["rule 1: bad", "rule 2: worse"] } } }, { "x-request-id": "req-1" })]);
    const e = await v.validators.create({ slug: "x", name: "X", rules: [] }).catch((x) => x);
    expect(e).toBeInstanceOf(VeridError);
    expect(e).toMatchObject({ status: 400, code: "invalid_request", requestId: "req-1" });
    expect(e.validationErrors).toEqual(["rule 1: bad", "rule 2: worse"]);
    expect(calls).toHaveLength(1);
  });

  it("gives up with a network error after the retry budget", async () => {
    const { v, calls } = client([new TypeError("fetch failed")]);
    const e = await v.agents.list().catch((x) => x);
    expect(e).toBeInstanceOf(VeridNetworkError);
    expect(calls).toHaveLength(3); // 1 try + 2 retries
  });

  it("a persistent 503 ends as a VeridError (not a hang)", async () => {
    const { v } = client([json(503, { error: { code: "unavailable", message: "chain down" } })]);
    const e = await v.receipts.anchor("rcpt_1").catch((x) => x);
    expect(e).toMatchObject({ status: 503, code: "unavailable" });
  });

  it("times out a hung request instead of waiting forever", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const v = new Verid({ apiKey: KEY, baseUrl: "https://verid.test", fetch: f as unknown as typeof fetch, timeoutMs: 30, maxRetries: 1 });
    expect(await v.agents.list().catch((x) => x)).toBeInstanceOf(VeridNetworkError);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("helpers", () => {
  it("agents.ensure falls back to the existing agent on a 409", async () => {
    const { v } = client([json(409, { error: { code: "conflict", message: "exists" } }), json(200, { data: [{ id: "agt_9", slug: "bot", name: "Bot" }] })]);
    expect((await v.agents.ensure({ slug: "bot" })).id).toBe("agt_9");
  });

  it("validators.ensure creates once and treats 'already exists' as success", async () => {
    const created = client([json(201, { validator: { id: "custom:x" } })]);
    expect(await created.v.validators.ensure({ slug: "x", name: "X", rules: [] })).toBe("custom:x");
    const existing = client([json(409, { error: { code: "conflict", message: "exists" } })]);
    expect(await existing.v.validators.ensure({ slug: "x", name: "X", rules: [] })).toBe("custom:x");
    const broken = client([json(400, { error: { code: "invalid_request", message: "bad rules" } })]);
    await expect(broken.v.validators.ensure({ slug: "x", name: "X", rules: [] })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("receipts.anchor distinguishes confirmed from pending (202)", async () => {
    const ok = client([json(200, { anchor: { status: "confirmed", transactionHash: "0xabc" } })]);
    expect(await ok.v.receipts.anchor("r")).toMatchObject({ confirmed: true, pending: false });
    const pending = client([json(202, { anchor: { status: "submitted", transactionHash: "0xdef" } })]);
    expect(await pending.v.receipts.anchor("r")).toMatchObject({ confirmed: false, pending: true });
  });

  it("builds shareable links from the dashboard origin", () => {
    const { v } = client([json(200, {})]);
    expect(v.receipts.proofUrl("rcpt_1")).toBe("https://verid.test/proof/rcpt_1");
    expect(v.executionUrl("exe_1")).toBe("https://verid.test/executions/exe_1");
  });
});
