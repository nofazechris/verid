import type { ChainReader, Hex32 } from "@verid/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createTestApp, makeAgent, runToAwaitingValidation, type Call, type TestApp } from "./harness";

let app: TestApp;
let call: Call;
let me: { user: string };
let agent: string;

beforeAll(async () => {
  app = await createTestApp();
  call = client(app);
  me = { user: (await app.seedUser("misc@example.com", "misc-ws")).userId };
  agent = await makeAgent(call, me);
}, 60_000);
afterAll(() => app.close());

async function anchoredReceipt(n = 10) {
  const id = await runToAwaitingValidation(call, me, agent, n);
  await call("POST", "/validations", { ...me, body: { executionId: id, validatorId: "research-validator" } });
  const receiptId = (await call("POST", "/receipts", { ...me, body: { executionId: id } })).json.receipt.receiptId;
  return { id, receiptId };
}

describe("public receipt view", () => {
  it("is readable without login and exposes NO private content", async () => {
    const { receiptId } = await anchoredReceipt();
    await call("POST", `/receipts/${receiptId}/anchor`, me);
    const r = await call("GET", `/public/receipts/${receiptId}`);
    expect(r.status).toBe(200);
    expect(r.json.receipt.receiptId).toBe(receiptId);
    expect(r.json.anchor.status).toBe("confirmed");
    // Nothing from the task, result or evidence content may appear.
    for (const secret of ["Illustrative Startup", "Find 10 AI startups", "directory.example.org", "tool_result"]) {
      expect(r.text).not.toContain(secret);
    }
    expect(r.json.validation.checks.every((c: any) => !("explanation" in c) && !("details" in c))).toBe(true);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("reports honest verification: data checks NOT_CHECKED without a bundle, chain NOT_CHECKED without a reader", async () => {
    const { receiptId } = await anchoredReceipt();
    await call("POST", `/receipts/${receiptId}/anchor`, me);
    const v = (await call("GET", `/public/receipts/${receiptId}`)).json.verification;
    const s = Object.fromEntries(v.checks.map((c: any) => [c.id, c.status]));
    expect(s).toMatchObject({ schema: "VALID", receipt_commitment: "VALID", task: "NOT_CHECKED", evidence: "NOT_CHECKED", arc_tx: "NOT_CHECKED" });
    expect(v.outcome).toBe("incomplete"); // never "verified" without actually checking
  });

  it("uses an injected chain reader for the Arc checks (and distinguishes RPC failure)", async () => {
    const reader: ChainReader = {
      registryAddress: "0x1111111111111111111111111111111111111111",
      chainId: async () => { throw new Error("rpc down"); },
      getTransaction: async () => ({ status: "pending" }),
      getAnchor: async () => null,
    };
    const local = await createTestApp({ chain: reader });
    const c = client(local);
    const u = (await local.seedUser("r@example.com", "r-ws")).userId;
    const ag = await makeAgent(c, { user: u });
    const id = await runToAwaitingValidation(c, { user: u }, ag);
    await c("POST", "/validations", { user: u, body: { executionId: id, validatorId: "research-validator" } });
    const rid = (await c("POST", "/receipts", { user: u, body: { executionId: id } })).json.receipt.receiptId;
    await c("POST", `/receipts/${rid}/anchor`, { user: u });
    const v = (await c("GET", `/public/receipts/${rid}`)).json.verification;
    expect(v.checks.find((x: any) => x.id === "arc_tx").status).toBe("UNAVAILABLE");
    await local.close();
  });

  it("returns 404 for unknown receipts", async () => {
    expect((await call("GET", "/public/receipts/rcpt_doesnotexist")).status).toBe(404);
  });
});

describe("stateless verify endpoint", () => {
  it("verifies a supplied receipt + bundle and detects tampering", async () => {
    const { receiptId, id } = await anchoredReceipt();
    const receipt = (await call("GET", `/receipts/${receiptId}`, me)).json.receipt;
    const ok = await call("POST", "/receipts/verify", { body: { receipt } });
    expect(ok.status).toBe(200);
    expect(ok.json.checks[1]).toMatchObject({ id: "receipt_commitment", status: "VALID" });

    const tampered = { ...receipt, result: { hash: `0x${"11".repeat(32)}` as Hex32 } };
    const bad = await call("POST", "/receipts/verify", { body: { receipt: tampered } });
    expect(bad.json.outcome).toBe("invalid");
    expect(id).toBeTruthy();
  });

  it("rejects malformed input and is rate limited per IP", async () => {
    expect((await call("POST", "/receipts/verify", { body: { nope: 1 }, ip: "198.51.100.7" })).json.checks[0].status).toBe("INVALID");
    let last;
    for (let i = 0; i < 31; i++) last = await call("POST", "/receipts/verify", { body: { receipt: {} }, ip: "198.51.100.8" });
    expect(last!.status).toBe(429);
  });
});

describe("pagination", () => {
  it("walks all pages in stable order with no duplicates or gaps", async () => {
    for (let i = 0; i < 7; i++) {
      await call("POST", "/agents", { ...me, body: { slug: `page-agent-${i}`, name: `P${i}`, version: "1" } });
      app.clock.advance(1000);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: any = await call("GET", `/agents?limit=3${cursor ? `&cursor=${cursor}` : ""}`, me);
      expect(r.status).toBe(200);
      seen.push(...r.json.data.map((a: any) => a.id));
      cursor = r.json.nextCursor;
      pages++;
    } while (cursor && pages < 20);
    const all = (await call("GET", "/agents?limit=100", me)).json.data.map((a: any) => a.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
    expect(pages).toBeGreaterThan(2);
  });

  it("rejects malformed cursors and out-of-range limits", async () => {
    expect((await call("GET", "/agents?cursor=%%%", me)).status).toBe(400);
    expect((await call("GET", `/agents?cursor=${Buffer.from("not-a-date|x").toString("base64url")}`, me)).status).toBe(400);
    expect((await call("GET", "/agents?limit=0", me)).status).toBe(400);
    expect((await call("GET", "/agents?limit=101", me)).status).toBe(400);
  });

  it("filters executions by status, validation and agent", async () => {
    const good = await runToAwaitingValidation(call, me, agent);
    await call("POST", "/validations", { ...me, body: { executionId: good, validatorId: "research-validator" } });
    const bad = await runToAwaitingValidation(call, me, agent, 3);
    await call("POST", "/validations", { ...me, body: { executionId: bad, validatorId: "research-validator" } });
    const failed = await call("GET", "/executions?validation=fail&limit=100", me);
    expect(failed.json.data.some((e: any) => e.id === bad)).toBe(true);
    expect(failed.json.data.some((e: any) => e.id === good)).toBe(false);
    const validated = await call("GET", "/executions?status=validated&limit=100", me);
    expect(validated.json.data.every((e: any) => e.status === "validated")).toBe(true);
    expect(failed.json.data[0].result).toBeUndefined(); // list never carries the raw result
  });
});

describe("overview metrics are derived from real data", () => {
  it("a fresh workspace has zeros and a null pass rate (no fabricated activity)", async () => {
    const u = (await app.seedUser("fresh@example.com", "fresh-ws")).userId;
    const o = (await call("GET", "/overview", { user: u })).json;
    expect(o).toMatchObject({ totalExecutions: 0, validatedExecutions: 0, validationPassRate: null, usdcSettledBaseUnits: "0" });
    expect(o.recentExecutions).toEqual([]);
  });

  it("counts passes and failures correctly", async () => {
    const u = (await app.seedUser("metrics@example.com", "metrics-ws")).userId;
    const as_ = { user: u };
    const ag = await makeAgent(call, as_);
    for (const n of [10, 10, 4]) {
      const id = await runToAwaitingValidation(call, as_, ag, n);
      await call("POST", "/validations", { ...as_, body: { executionId: id, validatorId: "research-validator" } });
    }
    const o = (await call("GET", "/overview", as_)).json;
    expect(o.totalExecutions).toBe(3);
    expect(o.validatedExecutions).toBe(2);
    expect(o.validationPassRate).toBeCloseTo(2 / 3);
    expect(o.recentFailedValidations).toHaveLength(1);
  });
});

describe("validators & network status", () => {
  it("lists validators with their versioned rules and per-workspace outcomes", async () => {
    const r = await call("GET", "/validators", me);
    const v = r.json.data[0];
    expect(v).toMatchObject({ id: "research-validator", version: "1.0.0" });
    expect(v.rules.join(" ")).toMatch(/does not confirm factual truth/);
    expect(typeof v.outcomes).toBe("object");
    expect(v).not.toHaveProperty("score"); // no arbitrary reputation score
  });

  it("reports backend and chain health SEPARATELY", async () => {
    const none = (await call("GET", "/network/status", { ip: "192.0.2.1" })).json;
    expect(none.backend).toEqual({ status: "ok", database: "ok" });
    expect(none.chain.status).toBe("not_configured");

    const up = await createTestApp({ chainStatus: async () => ({ chainId: 31337, blockNumber: 42 }) });
    expect((await client(up)("GET", "/network/status")).json.chain).toMatchObject({ status: "ok", blockNumber: 42 });
    await up.close();

    const down = await createTestApp({ chainStatus: async () => { throw new Error("rpc"); } });
    const s = (await client(down)("GET", "/network/status")).json;
    expect(s.backend.status).toBe("ok"); // the VERID backend is fine…
    expect(s.chain.status).toBe("unavailable"); // …only the chain is not
    await down.close();
  });
});

describe("activity feed", () => {
  it("lists real audit events for the caller's workspace only, newest first", async () => {
    const a = (await app.seedUser("act-a@example.com", "act-a")).userId;
    const b = (await app.seedUser("act-b@example.com", "act-b")).userId;
    const agentA = await makeAgent(call, { user: a });
    const exA = await runToAwaitingValidation(call, { user: a }, agentA);
    await call("POST", "/validations", { user: a, body: { executionId: exA, validatorId: "research-validator" } });
    const mine = (await call("GET", "/activity?limit=50", { user: a })).json;
    expect(mine.data.length).toBeGreaterThanOrEqual(4);
    expect(mine.data.some((e: any) => e.action === "execution.created")).toBe(true);
    expect(mine.data.some((e: any) => e.action === "validation.recorded")).toBe(true);
    expect((await call("GET", "/activity", { user: b })).json.data).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain("Illustrative Startup"); // no private content (evidence/result text) in the feed
  });
});
