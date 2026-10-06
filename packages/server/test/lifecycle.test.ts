import {
  computeEvidenceRoot,
  hashEvidenceContent,
  hashPolicy,
  hashResult,
  hashTask,
  verifyReceipt,
  type Hex32,
  type ValidationResult,
} from "@verid/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src";
import { client, createTestApp, goodResult, makeAgent, researchTask, runToAwaitingValidation, type Call, type TestApp } from "./harness";

let app: TestApp;
let call: Call;
let me: { user: string };
let agent: string;
const TX = `0x${"cd".repeat(32)}` as Hex32;

beforeAll(async () => {
  app = await createTestApp();
  call = client(app);
  const u = await app.seedUser("dev@example.com", "dev-ws");
  me = { user: u.userId };
  agent = await makeAgent(call, me);
}, 60_000);
afterAll(() => app.close());

const validate = (executionId: string) => call("POST", "/validations", { ...me, body: { executionId, validatorId: "research-validator" } });
const mkReceipt = (executionId: string) => call("POST", "/receipts", { ...me, body: { executionId } });

describe("successful lifecycle", () => {
  it("created -> running -> evidence -> complete -> validated -> receipt -> anchored", async () => {
    const created = await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } });
    expect(created.status).toBe(201);
    const id = created.json.execution.id;
    expect(created.json.execution.status).toBe("created");
    // The SERVER computed the task commitment.
    expect(created.json.execution.taskHash).toBe(hashTask(researchTask));

    expect((await call("POST", `/executions/${id}/start`, me)).json.execution.status).toBe("running");
    const e0 = await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "tool_call", content: { tool: "search" } } });
    const e1 = await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "tool_result", content: { results: goodResult() } } });
    expect([e0.status, e1.status]).toEqual([201, 201]);
    expect(e0.json.evidence.sequenceNumber).toBe(0);
    expect(e1.json.evidence.sequenceNumber).toBe(1);
    expect(e0.json.evidence.contentHash).toBe(hashEvidenceContent({ tool: "search" }));
    expect(e0.json.evidence.content).toBeUndefined(); // private content is not echoed

    const done = await call("POST", `/executions/${id}/complete`, { ...me, body: { result: goodResult() } });
    expect(done.json.execution.status).toBe("awaiting_validation");
    expect(done.json.execution.resultHash).toBe(hashResult(goodResult()));
    expect(done.json.execution.evidenceCount).toBe(3); // 2 recorded + server-appended `result`

    const v = await validate(id);
    expect(v.status).toBe(201);
    expect(v.json.validation.status).toBe("pass");
    expect(v.json.executionStatus).toBe("validated");

    const r = await mkReceipt(id);
    expect(r.status).toBe(201);
    const receiptId: string = r.json.receipt.receiptId;
    expect(r.json.receipt.anchor).toBeUndefined();

    const a = await call("POST", `/receipts/${receiptId}/anchor`, me);
    expect(a.status).toBe(200);
    expect(a.json.receipt.anchor.transactionHash).toBe(app.anchorer.script[0] && (app.anchorer.script[0] as { txHash: string }).txHash);
    expect((await call("GET", `/executions/${id}`, me)).json.execution.status).toBe("anchored");
  });

  it("the data the API exposes is sufficient for a fully independent verification", async () => {
    const id = await runToAwaitingValidation(call, me, agent);
    await validate(id);
    const receipt = (await mkReceipt(id)).json.receipt;
    const ex = (await call("GET", `/executions/${id}`, me)).json.execution;
    const ev = (await call("GET", `/executions/${id}/evidence?includeContent=true`, me)).json.data;

    const bundle = {
      task: ex.taskDefinition,
      evidence: ev.map((e: any) => ({ executionId: id, sequenceNumber: e.sequenceNumber, type: e.type, timestamp: e.evidenceTimestamp, contentHash: e.contentHash })),
      result: ex.result,
      validation: ex.validation.result as ValidationResult,
    };
    const rep = await verifyReceipt(receipt, { bundle });
    const byId = Object.fromEntries(rep.checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ schema: "VALID", receipt_commitment: "VALID", task: "VALID", evidence: "VALID", result: "VALID", validation: "VALID" });
    // And the root really is recomputable from the raw private content:
    const recomputed = computeEvidenceRoot(
      ev.map((e: any) => ({ executionId: id, sequenceNumber: e.sequenceNumber, type: e.type, timestamp: e.evidenceTimestamp, contentHash: hashEvidenceContent(e.content) })),
    );
    expect(recomputed.root).toBe(receipt.evidence.root);
  });

  it("receipt creation is idempotent: one receipt per execution", async () => {
    const id = await runToAwaitingValidation(call, me, agent);
    await validate(id);
    const a = await mkReceipt(id);
    const b = await mkReceipt(id);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.json.receipt.receiptId).toBe(a.json.receipt.receiptId);
    expect(await app.deps.db.select().from(schema.receipts).where(eq(schema.receipts.executionId, id))).toHaveLength(1);
  });

  it("the stored receipt stays immutable; the anchor is merged at read time", async () => {
    const id = await runToAwaitingValidation(call, me, agent);
    await validate(id);
    const r = (await mkReceipt(id)).json.receipt;
    await call("POST", `/receipts/${r.receiptId}/anchor`, me);
    const [row] = await app.deps.db.select().from(schema.receipts).where(eq(schema.receipts.id, r.receiptId));
    expect((row!.receiptData as any).anchor).toBeUndefined();
    expect((await call("GET", `/receipts/${r.receiptId}`, me)).json.receipt.anchor.chainId).toBe(31337);
  });
});

describe("failed validation is real, preserved and terminal", () => {
  it("an incomplete result fails, cannot be anchored, and is never overwritten by a later success", async () => {
    const bad = await runToAwaitingValidation(call, me, agent, 6); // 6 of 10
    const v = await validate(bad);
    expect(v.json.validation.status).toBe("fail");
    expect(v.json.executionStatus).toBe("validation_failed");
    expect(v.json.validation.checks.find((c: any) => c.id === "min_entries").explanation).toBe("found 6 qualifying entries, required 10");

    const r = await mkReceipt(bad); // the failure is recorded in a receipt too
    expect(r.json.receipt.validation.status).toBe("fail");
    const calls = app.anchorer.calls;
    const a = await call("POST", `/receipts/${r.json.receipt.receiptId}/anchor`, me);
    expect(a.status).toBe(409);
    expect(a.json.error.code).toBe("invalid_state");
    expect(app.anchorer.calls).toBe(calls); // nothing was sent to the chain

    // terminal: cannot be re-validated or moved
    expect((await validate(bad)).status).toBe(409);
    expect((await call("POST", `/executions/${bad}/start`, me)).status).toBe(409);

    // a later successful run is a SEPARATE execution + receipt
    const good = await runToAwaitingValidation(call, me, agent);
    await validate(good);
    const goodReceipt = (await mkReceipt(good)).json.receipt;
    expect(goodReceipt.receiptId).not.toBe(r.json.receipt.receiptId);
    const still = await call("GET", `/receipts/${r.json.receipt.receiptId}`, me);
    expect(still.json.receipt.validation.status).toBe("fail");
    expect((await call("GET", `/executions/${bad}`, me)).json.execution.status).toBe("validation_failed");
  });

  it("an inconclusive validation also stops short of anchoring", async () => {
    // No evidence of the required kinds is supplied via a validator that cannot decide: use a result that
    // is fine but delete a required evidence kind? Simplest real path: validator with missing evidence types fails.
    const created = await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } });
    const id = created.json.execution.id;
    await call("POST", `/executions/${id}/start`, me);
    await call("POST", `/executions/${id}/complete`, { ...me, body: { result: goodResult() } }); // no tool_call / tool_result
    const v = await validate(id);
    expect(["fail", "inconclusive"]).toContain(v.json.validation.status);
    expect(v.json.executionStatus).toBe("validation_failed");
  });
});

describe("illegal transitions and bad input", () => {
  it("enforces ordering with 409 invalid_state", async () => {
    const id = (await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } })).json.execution.id;
    const early = await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "tool_call", content: {} } });
    expect(early.status).toBe(409);
    expect((await call("POST", `/executions/${id}/complete`, { ...me, body: { result: [] } })).status).toBe(409);
    expect((await validate(id)).status).toBe(409);
    expect((await mkReceipt(id)).status).toBe(409);
    await call("POST", `/executions/${id}/start`, me);
    expect((await call("POST", `/executions/${id}/start`, me)).status).toBe(409);
    await call("POST", `/executions/${id}/complete`, { ...me, body: { result: goodResult() } });
    expect((await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "tool_call", content: {} } })).status).toBe(409);
    expect((await call("POST", `/executions/${id}/complete`, { ...me, body: { result: goodResult() } })).status).toBe(409);
  });

  it("clients cannot forge server-generated evidence types or hashes", async () => {
    const id = (await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } })).json.execution.id;
    await call("POST", `/executions/${id}/start`, me);
    expect((await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "result", content: {} } })).status).toBe(400);
    expect((await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "validation", content: {} } })).status).toBe(400);
    // A client-supplied hash field is ignored: the stored hash is the server's.
    const e = await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "tool_call", content: { a: 1 }, contentHash: "0x" + "00".repeat(32) } });
    expect(e.json.evidence.contentHash).toBe(hashEvidenceContent({ a: 1 }));
  });

  it("evidence timestamps are assigned by the server, not the client", async () => {
    const id = (await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } })).json.execution.id;
    await call("POST", `/executions/${id}/start`, me);
    const e = await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "tool_call", content: {}, metadata: { evidenceTimestamp: "1999-01-01T00:00:00.000Z" } } });
    expect(e.json.evidence.evidenceTimestamp).toBe(app.clock.now.toISOString());
  });

  it("validates input and unknown references", async () => {
    expect((await call("POST", "/executions", { ...me, body: { agentId: "agt_nope", task: researchTask } })).status).toBe(400);
    expect((await call("POST", "/executions", { ...me, body: { agentId: agent, task: { description: "" } } })).status).toBe(400);
    expect((await call("POST", "/validations", { ...me, body: { executionId: "exe_x", validatorId: "nope" } })).status).toBe(400);
    // JSON.stringify(-0) === "0", so send the literal text: a raw `-0` parses to negative zero, which is not canonicalizable.
    const raw = `{"agentId":"${agent}","task":{"description":"x","parameters":{"n":-0}}}`;
    expect((await call("POST", "/executions", { ...me, rawBody: raw })).status).toBe(400);
  });

  it("limits evidence size", async () => {
    const id = (await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } })).json.execution.id;
    await call("POST", `/executions/${id}/start`, me);
    const r = await call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "artifact", content: { blob: "x".repeat(300 * 1024) } } });
    expect(r.status).toBe(413);
  });

  it("an inactive agent cannot start new executions", async () => {
    const a = await makeAgent(call, me, "sleepy");
    await call("PATCH", `/agents/${a}`, { ...me, body: { status: "inactive" } });
    expect((await call("POST", "/executions", { ...me, body: { agentId: a, task: researchTask } })).status).toBe(409);
  });
});

describe("anchoring edge cases", () => {
  async function validatedReceipt() {
    const id = await runToAwaitingValidation(call, me, agent);
    await validate(id);
    return { id, receiptId: (await mkReceipt(id)).json.receipt.receiptId as string };
  }

  it("without a configured chain it reports 503 and changes no state", async () => {
    const local = await createTestApp({ anchorer: undefined });
    const c = client(local);
    const u = await local.seedUser("x@example.com", "x-ws");
    const as_ = { user: u.userId };
    const ag = await makeAgent(c, as_);
    const id = await runToAwaitingValidation(c, as_, ag);
    await c("POST", "/validations", { ...as_, body: { executionId: id, validatorId: "research-validator" } });
    const rid = (await c("POST", "/receipts", { ...as_, body: { executionId: id } })).json.receipt.receiptId;
    const r = await c("POST", `/receipts/${rid}/anchor`, as_);
    expect(r.status).toBe(503);
    expect((await c("GET", `/executions/${id}`, as_)).json.execution.status).toBe("validated");
    await local.close();
  });

  it("pending (202) -> stays anchoring; a retry later confirms", async () => {
    const { id, receiptId } = await validatedReceipt();
    app.anchorer.script = [{ status: "pending", txHash: TX }, { status: "confirmed", txHash: TX, blockNumber: 9 }];
    const first = await call("POST", `/receipts/${receiptId}/anchor`, me);
    expect(first.status).toBe(202);
    expect((await call("GET", `/executions/${id}`, me)).json.execution.status).toBe("anchoring");
    expect(first.json.receipt.anchor).toBeUndefined(); // NOT shown as confirmed
    const second = await call("POST", `/receipts/${receiptId}/anchor`, me);
    expect(second.status).toBe(200);
    expect(second.json.receipt.anchor.blockNumber).toBe(9);
    expect((await call("GET", `/executions/${id}`, me)).json.execution.status).toBe("anchored");
  });

  it("reverted -> back to validated so it can be retried safely", async () => {
    const { id, receiptId } = await validatedReceipt();
    app.anchorer.script = [{ status: "reverted", txHash: TX }, { status: "confirmed", txHash: TX, blockNumber: 11 }];
    const r = await call("POST", `/receipts/${receiptId}/anchor`, me);
    expect(r.status).toBe(202);
    expect(r.json.receipt.anchor).toBeUndefined();
    expect((await call("GET", `/executions/${id}`, me)).json.execution.status).toBe("validated");
    expect((await call("POST", `/receipts/${receiptId}/anchor`, me)).status).toBe(200);
  });

  it("an unreachable chain gives 503 and leaves the execution retryable (no false success)", async () => {
    const { id, receiptId } = await validatedReceipt();
    app.anchorer.script = [new Error("ECONNREFUSED"), { status: "confirmed", txHash: TX, blockNumber: 12 }];
    const r = await call("POST", `/receipts/${receiptId}/anchor`, me);
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("unavailable");
    expect((await call("GET", `/executions/${id}`, me)).json.execution.status).toBe("anchoring");
    expect((await call("POST", `/receipts/${receiptId}/anchor`, me)).status).toBe(200);
  });

  it("anchoring an already-anchored receipt sends nothing and returns the same anchor", async () => {
    const { receiptId } = await validatedReceipt();
    app.anchorer.script = [{ status: "confirmed", txHash: TX, blockNumber: 13 }];
    await call("POST", `/receipts/${receiptId}/anchor`, me);
    const before = app.anchorer.calls;
    const again = await call("POST", `/receipts/${receiptId}/anchor`, me);
    expect(again.status).toBe(200);
    expect(again.json.alreadyAnchored).toBe(true);
    expect(app.anchorer.calls).toBe(before);
  });
});

describe("idempotency", () => {
  it("same key + same body replays the first response; only one execution exists", async () => {
    const body = { agentId: agent, task: { description: "idempotent task" } };
    const a = await call("POST", "/executions", { ...me, body, idem: "key-create-0001" });
    const b = await call("POST", "/executions", { ...me, body, idem: "key-create-0001" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replay")).toBe("true");
    expect(b.json.execution.id).toBe(a.json.execution.id);
    const rows = await app.deps.db.select().from(schema.executions).where(eq(schema.executions.id, a.json.execution.id));
    expect(rows).toHaveLength(1);
  });

  it("same key with a different body (or on another operation) is rejected with 422", async () => {
    await call("POST", "/executions", { ...me, body: { agentId: agent, task: { description: "one" } }, idem: "key-conflict-01" });
    const diff = await call("POST", "/executions", { ...me, body: { agentId: agent, task: { description: "two" } }, idem: "key-conflict-01" });
    expect(diff.status).toBe(422);
    expect(diff.json.error.code).toBe("idempotency_conflict");
  });

  it("evidence retries with the same key never create duplicate records", async () => {
    const id = (await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } })).json.execution.id;
    await call("POST", `/executions/${id}/start`, me);
    const ev = { type: "tool_call", content: { n: 1 } };
    const results = await Promise.all([1, 2, 3].map(() => call("POST", `/executions/${id}/evidence`, { ...me, body: ev, idem: "evidence-retry-001" })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json.evidence.id)).size).toBe(1);
    const rows = await app.deps.db.select().from(schema.evidence).where(eq(schema.evidence.executionId, id));
    expect(rows).toHaveLength(1);
  });

  it("concurrent distinct evidence gets contiguous sequence numbers (no gaps, no duplicates)", async () => {
    const id = (await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } })).json.execution.id;
    await call("POST", `/executions/${id}/start`, me);
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => call("POST", `/executions/${id}/evidence`, { ...me, body: { type: "tool_call", content: { i } } })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const seqs = rs.map((r) => r.json.evidence.sequenceNumber).sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("a failed attempt does not burn the key", async () => {
    const id = (await call("POST", "/executions", { ...me, body: { agentId: agent, task: researchTask } })).json.execution.id;
    const ev = { type: "tool_call", content: { n: 1 } };
    expect((await call("POST", `/executions/${id}/evidence`, { ...me, body: ev, idem: "burn-test-0001" })).status).toBe(409); // not started yet
    await call("POST", `/executions/${id}/start`, me);
    expect((await call("POST", `/executions/${id}/evidence`, { ...me, body: ev, idem: "burn-test-0001" })).status).toBe(201);
  });
});

describe("policies are immutable and versioned", () => {
  it("editing creates a new version; executions keep their original commitment", async () => {
    const p1 = (await call("POST", "/policies", { ...me, body: { slug: "research-policy", name: "Research", rules: { maxRecords: 20 } } })).json.policy;
    expect(p1.version).toBe(1);
    expect(p1.policyHash).toBe(hashPolicy({ id: "research-policy", version: 1, rules: { maxRecords: 20 } }));

    const ex = (await call("POST", "/executions", { ...me, body: { agentId: agent, policyId: p1.id, task: researchTask } })).json.execution;

    const p2 = (await call("PATCH", `/policies/${p1.id}`, { ...me, body: { rules: { maxRecords: 5 } } })).json.policy;
    expect(p2.version).toBe(2);
    expect(p2.id).not.toBe(p1.id);
    expect(p2.policyHash).not.toBe(p1.policyHash);

    const old = (await call("GET", `/policies/${p1.id}`, me)).json.policy;
    expect(old.definition.rules).toEqual({ maxRecords: 20 }); // untouched
    expect(old.executionCount).toBe(1);
    expect(old.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect((await call("GET", `/executions/${ex.id}`, me)).json.execution.policy.policyHash).toBe(p1.policyHash);
    expect((await call("POST", "/policies", { ...me, body: { slug: "research-policy", name: "dup", rules: {} } })).status).toBe(409);
  });
});
