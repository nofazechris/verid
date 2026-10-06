import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createTestApp, makeAgent, runToAwaitingValidation, type Call, type TestApp } from "./harness";

let app: TestApp;
let call: Call;
let me: { user: string };
let agent: string;

beforeAll(async () => {
  app = await createTestApp();
  call = client(app);
  me = { user: (await app.seedUser("val@example.com", "val-ws")).userId };
  agent = await makeAgent(call, me);
}, 60_000);
afterAll(() => app.close());

const RULES = [
  { type: "items", path: "$", min: 10 },
  { type: "required_fields", path: "$[*]", fields: ["name", "website"] },
  { type: "field_format", path: "$[*].website", format: "http_url" },
  { type: "unique", path: "$[*].name" },
  { type: "evidence", types: ["tool_call", "tool_result", "result"] },
];
const create = (slug: string, rules: unknown[] = RULES, as: object = me) => call("POST", "/validators", { ...as, body: { slug, name: `Checker ${slug}`, description: "test", rules } });
const validate = (executionId: string, validatorId: string) => call("POST", "/validations", { ...me, body: { executionId, validatorId } });

describe("creating validators", () => {
  it("creates version 1, hashes the rules, and lists it next to the built-in one", async () => {
    const r = await create("startup-list");
    expect(r.status).toBe(201);
    expect(r.json.validator).toMatchObject({ id: "custom:startup-list", slug: "startup-list", origin: "workspace", version: 1 });
    expect(r.json.validator.definitionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.json.validator.versionLabel).toBe(`1+${r.json.validator.definitionHash.slice(2, 14)}`);
    expect(r.json.validator.rules[0]).toMatch(/at least 10/);

    const list = (await call("GET", "/validators", me)).json.data as { id: string; origin: string }[];
    expect(list.map((v) => [v.id, v.origin])).toEqual(expect.arrayContaining([["research-validator", "verid"], ["custom:startup-list", "workspace"]]));
  });

  it("rejects invalid rules with every problem listed, and duplicate slugs", async () => {
    const bad = await create("broken", [{ type: "items", path: "name" }, { type: "mystery" }, { type: "unique", path: "$[*].x", oops: 1 }]);
    expect(bad.status).toBe(400);
    expect(bad.json.error.details.errors.length).toBeGreaterThanOrEqual(3);
    expect((await create("startup-list")).status).toBe(409);
    expect((await call("POST", "/validators", { ...me, body: { slug: "Bad Slug!", name: "x", rules: RULES } })).status).toBe(400);
    expect((await create("huge", Array(60).fill({ type: "unique", path: "$" }))).status).toBe(400);
  });

  it("viewers cannot create, test or version; other workspaces cannot see or use it", async () => {
    const viewer = (await call("POST", "/api-keys", { ...me, body: { name: "ro", role: "viewer" } })).json.key;
    expect((await create("by-viewer", RULES, { key: viewer })).status).toBe(403);
    expect((await call("POST", "/validators/test", { key: viewer, body: { rules: RULES, result: [] } })).status).toBe(403);
    expect((await call("PATCH", "/validators/startup-list", { key: viewer, body: { name: "x" } })).status).toBe(403);

    const mallory = { user: (await app.seedUser("mal-val@example.com", "mal-val-ws")).userId };
    const theirAgent = await makeAgent(call, mallory);
    const id = await runToAwaitingValidation(call, mallory, theirAgent);
    const r = await call("POST", "/validations", { ...mallory, body: { executionId: id, validatorId: "custom:startup-list" } });
    expect(r.status).toBe(400); // not found in THEIR workspace
    expect(((await call("GET", "/validators", mallory)).json.data as { id: string }[]).some((v) => v.id === "custom:startup-list")).toBe(false);
  });
});

describe("versions are immutable", () => {
  it("editing creates version N+1 and a pinned id keeps using the old rules", async () => {
    await create("versioned", [{ type: "items", path: "$", min: 10 }]);
    const v2 = await call("PATCH", "/validators/versioned", { ...me, body: { rules: [{ type: "items", path: "$", min: 3 }] } });
    expect(v2.status).toBe(201);
    expect(v2.json.validator.version).toBe(2);

    const list = (await call("GET", "/validators", me)).json.data as { id: string; version: number; versions?: unknown[] }[];
    const entry = list.find((v) => v.id === "custom:versioned")!;
    expect(entry.version).toBe(2);
    expect(entry.versions).toHaveLength(2);

    const ex = await runToAwaitingValidation(call, me, agent, 5); // only 5 entries
    // pinned to v1 (needs 10) -> fail; latest v2 (needs 3) would pass. v1 must still mean what it always meant.
    const failed = await validate(ex, "custom:versioned@1");
    expect(failed.json.validation.status).toBe("fail");
    expect(failed.json.validation.validatorVersion).toMatch(/^1\+/);
    const ex2 = await runToAwaitingValidation(call, me, agent, 5);
    const passed = await validate(ex2, "custom:versioned");
    expect(passed.json.validation.status).toBe("pass");
    expect(passed.json.validation.validatorVersion).toMatch(/^2\+/);
    expect((await call("PATCH", "/validators/nope", { ...me, body: { name: "x" } })).status).toBe(404);
  });
});

describe("using a workspace validator in the real lifecycle", () => {
  it("pass -> validated -> receipt (names the validator and version) -> anchored", async () => {
    const ex = await runToAwaitingValidation(call, me, agent, 10);
    const v = await validate(ex, "custom:startup-list");
    expect(v.status).toBe(201);
    expect(v.json.validation).toMatchObject({ status: "pass", validatorId: "custom:startup-list" });
    expect(v.json.executionStatus).toBe("validated");
    const ids = (v.json.validation.checks as { id: string }[]).map((c) => c.id);
    expect(ids.slice(-2)).toEqual(["factual_claims_unverified", "rules_authored_by_workspace"]);

    const receipt = (await call("POST", "/receipts", { ...me, body: { executionId: ex } })).json.receipt;
    expect(receipt.validation).toMatchObject({ status: "pass", validatorId: "custom:startup-list" });
    expect(receipt.validation.validatorVersion).toMatch(/^1\+[0-9a-f]{12}$/);
    expect((await call("POST", `/receipts/${receipt.receiptId}/anchor`, me)).status).toBe(200);
  });

  it("fail is a real, preserved, terminal outcome that can never be anchored", async () => {
    const ex = await runToAwaitingValidation(call, me, agent, 6);
    const v = await validate(ex, "custom:startup-list");
    expect(v.json.validation.status).toBe("fail");
    expect(v.json.executionStatus).toBe("validation_failed");
    const failing = (v.json.validation.checks as { ok: boolean; explanation?: string }[]).find((c) => !c.ok)!;
    expect(failing.explanation).toMatch(/6 items/);
    const receipt = (await call("POST", "/receipts", { ...me, body: { executionId: ex } })).json.receipt;
    expect((await call("POST", `/receipts/${receipt.receiptId}/anchor`, me)).status).toBe(409);
    expect((await validate(ex, "custom:startup-list")).status).toBe(409); // cannot be re-validated into a pass
  });

  it("an unknown id lists what is available and how to address workspace validators", async () => {
    const ex = await runToAwaitingValidation(call, me, agent);
    const r = await validate(ex, "custom:does-not-exist");
    expect(r.status).toBe(400);
    expect(r.json.error.details.hint).toMatch(/custom:<slug>/);
  });
});

describe("dry-run testing", () => {
  it("evaluates a sample without storing anything", async () => {
    const before = (await call("GET", "/validators", me)).json.data.length;
    const r = await call("POST", "/validators/test", { ...me, body: { rules: [{ type: "items", path: "$", min: 2 }, { type: "field_format", path: "$[*].email", format: "email" }], result: [{ email: "a@x.io" }, { email: "nope" }] } });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("fail");
    expect(r.json.checks.find((c: { ok: boolean }) => !c.ok).explanation).toContain("$[1].email");
    expect((await call("GET", "/validators", me)).json.data.length).toBe(before);
    expect((await call("POST", "/validators/test", { ...me, body: { rules: [{ type: "nope" }], result: [] } })).status).toBe(400);
  });
});
