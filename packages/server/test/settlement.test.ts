import type { Hex32 } from "@verid/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EscrowGateway, OnchainEscrow, TxResult, ValidationRecorder } from "../src";
import { client, createTestApp, makeAgent, runToAwaitingValidation, type Call, type TestApp } from "./harness";

const TX = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(32)}` as Hex32;
const PAYER = "0x00000000000000000000000000000000000000a1";
const PAYEE = "0x00000000000000000000000000000000000000b2";

/**
 * In-memory stand-in for the contracts that mimics their RULES (the real contracts are covered by the Foundry
 * tests and by @verid/arc's anvil tests): release needs a recorded Pass AND a Pass anchor; refund needs a
 * recorded Fail or an expired deadline, and never when releasable.
 */
class FakeChain {
  validations = new Map<string, "pass" | "fail" | "inconclusive">();
  anchored = new Map<string, "pass" | "fail" | "inconclusive">();
  escrows = new Map<string, OnchainEscrow>();
  calls = { record: 0, release: 0, refund: 0 };
  releaseOutcome: "confirmed" | "pending" | "reverted" = "confirmed";
  constructor(private now: () => Date) {}

  fund(executionId: string, amount = "25000000", deadlineDays = 7) {
    this.escrows.set(executionId, {
      status: "funded", payer: PAYER, payee: PAYEE, amount, deadline: Math.floor(this.now().getTime() / 1000) + deadlineDays * 86_400,
    });
  }
  private releasable = (id: string) => this.escrows.get(id)?.status === "funded" && this.validations.get(id) === "pass" && this.anchored.get(id) === "pass";
  private refundable = (id: string) => {
    const e = this.escrows.get(id);
    return e?.status === "funded" && !this.releasable(id) && (this.validations.get(id) === "fail" || this.now().getTime() / 1000 > e.deadline);
  };

  recorder: ValidationRecorder = {
    target: { validationAddress: "0x2222222222222222222222222222222222222222" },
    record: async (i) => {
      this.calls.record++;
      const prior = this.validations.get(i.executionId);
      if (prior && prior !== i.status) throw new Error("conflicting on-chain validation record");
      this.validations.set(i.executionId, i.status);
      return { status: "confirmed", txHash: TX(1) };
    },
  };

  escrow: EscrowGateway = {
    target: { escrowAddress: "0x3333333333333333333333333333333333333333", chainId: 31337, network: "local-test" },
    token: async () => "0x4444444444444444444444444444444444444444",
    read: async (id) => this.escrows.get(id) ?? { status: "none", payer: "0x0", payee: "0x0", amount: "0", deadline: 0 },
    canRelease: async (id) => this.releasable(id),
    canRefund: async (id) => this.refundable(id),
    release: async (id): Promise<TxResult> => {
      this.calls.release++;
      if (this.releaseOutcome === "reverted") return { status: "reverted", txHash: TX(9) };
      if (!this.releasable(id)) throw new Error("NotReleasable");
      this.escrows.set(id, { ...this.escrows.get(id)!, status: "released" });
      return this.releaseOutcome === "pending" ? { status: "pending", txHash: TX(2) } : { status: "confirmed", txHash: TX(2) };
    },
    refund: async (id): Promise<TxResult> => {
      this.calls.refund++;
      if (!this.refundable(id)) throw new Error("NotRefundable");
      this.escrows.set(id, { ...this.escrows.get(id)!, status: "refunded" });
      return { status: "confirmed", txHash: TX(3) };
    },
  };
}

let app: TestApp;
let call: Call;
let chain: FakeChain;
let me: { user: string };
let agent: string;

beforeAll(async () => {
  app = await createTestApp();
  chain = new FakeChain(() => app.clock.now);
  app.deps.validationRecorder = chain.recorder;
  app.deps.escrow = chain.escrow;
  // The fake anchorer also writes to the fake registry so the escrow can see anchors.
  const submit = app.anchorer.submit.bind(app.anchorer);
  app.anchorer.submit = async (receipt) => {
    const out = await submit(receipt);
    if (out.status === "confirmed") chain.anchored.set(receipt.executionId, receipt.validation.status);
    return out;
  };
  call = client(app);
  me = { user: (await app.seedUser("pay@example.com", "pay-ws")).userId };
  agent = await makeAgent(call, me);
}, 60_000);
afterAll(() => app.close());

const validate = (id: string) => call("POST", "/validations", { ...me, body: { executionId: id, validatorId: "research-validator" } });

/** A validated + receipted execution (not yet anchored). `n` < 10 makes the validator FAIL. */
async function validated(n = 10) {
  const id = await runToAwaitingValidation(call, me, agent, n);
  const v = await validate(id);
  const receipt = (await call("POST", "/receipts", { ...me, body: { executionId: id } })).json.receipt.receiptId as string;
  return { id, receipt, status: v.json.validation.status as string };
}
async function anchored() {
  const e = await validated();
  expect((await call("POST", `/receipts/${e.receipt}/anchor`, me)).status).toBe(200);
  return e;
}
const settlement = (id: string) => call("GET", `/executions/${id}/settlement`, me);
const register = (id: string, as: object = me) => call("POST", `/executions/${id}/settlement`, { ...as, body: {} });
const settle = (id: string, as: object = me) => call("POST", `/executions/${id}/settle`, { ...as, body: {} });
const status = async (id: string) => (await call("GET", `/executions/${id}`, me)).json.execution.status as string;

describe("registering an escrow", () => {
  it("reads payer/payee/amount from the CHAIN and refuses when nothing was funded", async () => {
    const e = await anchored();
    const none = await register(e.id);
    expect(none.status).toBe(404);

    chain.fund(e.id, "25000000");
    const r = await register(e.id);
    expect(r.status).toBe(201);
    expect(r.json.settlement).toMatchObject({
      executionId: e.id, requesterAddress: PAYER, recipientAddress: PAYEE, amount: "25000000", status: "escrowed", chainId: 31337,
      escrowAddress: chain.escrow.target.escrowAddress,
    });
    expect((await register(e.id)).status).toBe(409); // one settlement per execution
  });

  it("the client cannot choose the payee or amount", async () => {
    const e = await anchored();
    chain.fund(e.id, "1000000");
    const r = await call("POST", `/executions/${e.id}/settlement`, { ...me, body: { payee: "0x0000000000000000000000000000000000000bad", amount: "999999999" } });
    expect(r.json.settlement).toMatchObject({ recipientAddress: PAYEE, amount: "1000000" });
  });

  it("GET shows funding parameters and live on-chain readiness", async () => {
    const e = await validated();
    const before = (await settlement(e.id)).json;
    expect(before.escrow).toMatchObject({ configured: true, chainId: 31337, tokenDecimals: 6, escrowAddress: chain.escrow.target.escrowAddress });
    expect(before.escrow.executionKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(before.settlement).toBeNull();
    expect(before.onchain.status).toBe("none");
    chain.fund(e.id);
    expect((await settlement(e.id)).json.readiness).toEqual({ release: false, refund: false });
  });
});

describe("settling", () => {
  it("anchored + funded: records the validation on-chain, releases, and the execution becomes settled", async () => {
    const e = await anchored();
    chain.fund(e.id, "25000000");
    await register(e.id);
    const before = chain.calls.record;
    const s = await settle(e.id);
    expect(s.status).toBe(200);
    expect(s.json.settlement).toMatchObject({ status: "released", releaseTxHash: TX(2) });
    expect(s.json.executionStatus).toBe("settled");
    expect(chain.validations.get(e.id)).toBe("pass");
    expect(chain.calls.record).toBeGreaterThan(before);
    expect(await status(e.id)).toBe("settled");

    // idempotent: nothing is sent again
    const rel = chain.calls.release;
    const again = await settle(e.id);
    expect(again.json.alreadySettled).toBe(true);
    expect(chain.calls.release).toBe(rel);

    const ov = await call("GET", "/overview", me);
    expect(BigInt(ov.json.usdcSettledBaseUnits)).toBeGreaterThanOrEqual(25_000_000n);
  });

  it("is refused while the execution is only validated (not anchored)", async () => {
    const e = await validated();
    chain.fund(e.id);
    await register(e.id);
    const s = await settle(e.id);
    expect(s.status).toBe(409);
    expect(s.json.error.code).toBe("invalid_state");
    expect(chain.escrows.get(e.id)!.status).toBe("funded");
    expect(await status(e.id)).toBe("validated");
  });

  it("the server's own state machine still blocks settling a merely-validated execution even if the chain would allow it", async () => {
    const e = await validated();
    chain.validations.set(e.id, "pass");
    chain.anchored.set(e.id, "pass"); // e.g. anchored out-of-band
    chain.fund(e.id);
    await register(e.id);
    const releases = chain.calls.release;
    expect((await settle(e.id)).status).toBe(409);
    expect(chain.calls.release).toBe(releases);
    expect(await status(e.id)).toBe("validated");
  });

  it("a FAILED validation can never release: it is recorded on-chain and the payer is refunded", async () => {
    const e = await validated(6);
    expect(e.status).toBe("fail");
    expect((await call("POST", `/receipts/${e.receipt}/anchor`, me)).status).toBe(409); // cannot anchor a failure
    chain.fund(e.id, "7000000");
    await register(e.id);
    const releases = chain.calls.release;
    const s = await settle(e.id);
    expect(s.status).toBe(200);
    expect(s.json.settlement.status).toBe("refunded");
    expect(s.json.settlement.refundTxHash).toBe(TX(3));
    expect(chain.validations.get(e.id)).toBe("fail");
    expect(chain.calls.release).toBe(releases);
    expect(await status(e.id)).toBe("validation_failed"); // preserved and terminal
  });

  it("a pending release is finalized from the chain on the next call", async () => {
    const e = await anchored();
    chain.fund(e.id);
    await register(e.id);
    chain.releaseOutcome = "pending";
    const first = await settle(e.id);
    chain.releaseOutcome = "confirmed";
    expect(first.status).toBe(202);
    expect(first.json.pending).toBe(true);
    expect(await status(e.id)).toBe("settling");
    const second = await settle(e.id);
    expect(second.json.settlement.status).toBe("released");
    expect(await status(e.id)).toBe("settled");
  });

  it("a reverted release moves nothing and returns the execution to anchored for a safe retry", async () => {
    const e = await anchored();
    chain.fund(e.id);
    await register(e.id);
    chain.releaseOutcome = "reverted";
    const bad = await settle(e.id);
    chain.releaseOutcome = "confirmed";
    expect(bad.status).toBe(503);
    expect(await status(e.id)).toBe("anchored");
    expect((await settle(e.id)).json.settlement.status).toBe("released");
  });

  it("concurrent settles move the money exactly once and both converge on settled", async () => {
    const e = await anchored();
    chain.fund(e.id);
    await register(e.id);
    const results = await Promise.all([settle(e.id), settle(e.id)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(chain.escrows.get(e.id)!.status).toBe("released");
    expect(await status(e.id)).toBe("settled");
    expect((await settlement(e.id)).json.settlement.status).toBe("released");
  });

  it("an expired deadline refunds an anchored execution whose validation was never recorded on-chain", async () => {
    const e = await anchored();
    chain.validations.delete(e.id); // simulate: the on-chain record is missing and cannot be written
    const rec = app.deps.validationRecorder;
    app.deps.validationRecorder = undefined;
    chain.fund(e.id, "3000000", 1);
    await register(e.id);
    expect((await settle(e.id)).status).toBe(409); // not yet: no Pass recorded, deadline not reached
    app.clock.advance(2 * 86_400_000);
    const s = await settle(e.id);
    app.deps.validationRecorder = rec;
    expect(s.json.settlement.status).toBe("refunded");
    expect(await status(e.id)).toBe("anchored");
  });
});

describe("listing settlements", () => {
  it("lists this workspace's escrows newest-first with per-status totals, filters, paginates and never leaks other workspaces", async () => {
    const owner = { user: (await app.seedUser("list@example.com", "list-ws")).userId };
    const ag = await makeAgent(call, owner);
    const mk = async (amount: string) => {
      app.clock.advance(60_000); // the fake clock is frozen, so give each escrow a distinct creation time ("newest first")
      const id = await runToAwaitingValidation(call, owner, ag);
      await call("POST", "/validations", { ...owner, body: { executionId: id, validatorId: "research-validator" } });
      const rcpt = (await call("POST", "/receipts", { ...owner, body: { executionId: id } })).json.receipt.receiptId;
      await call("POST", `/receipts/${rcpt}/anchor`, owner);
      chain.fund(id, amount);
      await call("POST", `/executions/${id}/settlement`, { ...owner, body: {} });
      return id;
    };
    const a = await mk("10000000");
    const b = await mk("5000000");
    const c = await mk("2500000");
    await call("POST", `/executions/${a}/settle`, { ...owner, body: {} }); // a released

    const all = await call("GET", "/settlements", owner);
    expect(all.status).toBe(200);
    expect(all.json.data.map((x: { executionId: string }) => x.executionId)).toEqual([c, b, a]);
    expect(all.json.totals).toEqual({ escrowed: { count: 2, amount: "7500000" }, released: { count: 1, amount: "10000000" }, refunded: { count: 0, amount: "0" } });
    expect(all.json.data[0]).toMatchObject({ agentName: "ResearchBot", status: "escrowed", executionStatus: "anchored" });

    const released = await call("GET", "/settlements?status=released", owner);
    expect(released.json.data.map((x: { executionId: string }) => x.executionId)).toEqual([a]);

    const p1 = await call("GET", "/settlements?limit=2", owner);
    expect(p1.json.data).toHaveLength(2);
    expect(p1.json.nextCursor).toBeTruthy();
    const p2 = await call("GET", `/settlements?limit=2&cursor=${p1.json.nextCursor}`, owner);
    expect(p2.json.data.map((x: { executionId: string }) => x.executionId)).toEqual([a]);
    expect(p2.json.nextCursor).toBeNull();

    const other = { user: (await app.seedUser("list-other@example.com", "list-other-ws")).userId };
    const theirs = await call("GET", "/settlements", other);
    expect(theirs.json.data).toEqual([]);
    expect(theirs.json.totals.escrowed.count).toBe(0);
    expect((await call("GET", "/settlements?status=bogus", owner)).status).toBe(400);
  });
});

describe("access control and availability", () => {
  it("other workspaces cannot see, register or settle a foreign execution", async () => {
    const e = await anchored();
    chain.fund(e.id);
    const mallory = { user: (await app.seedUser("mallory@example.com", "mal-ws")).userId };
    expect((await call("GET", `/executions/${e.id}/settlement`, mallory)).status).toBe(404);
    expect((await register(e.id, mallory)).status).toBe(404);
    expect((await settle(e.id, mallory)).status).toBe(404);
  });

  it("viewer keys are read-only for settlement", async () => {
    const e = await anchored();
    chain.fund(e.id);
    const viewer = (await call("POST", "/api-keys", { ...me, body: { name: "ro", role: "viewer" } })).json.key;
    expect((await call("GET", `/executions/${e.id}/settlement`, { key: viewer })).status).toBe(200);
    expect((await register(e.id, { key: viewer })).status).toBe(403);
    expect((await settle(e.id, { key: viewer })).status).toBe(403);
  });

  it("reports honestly when no escrow is configured", async () => {
    const saved = app.deps.escrow;
    app.deps.escrow = undefined;
    const e = await anchored();
    expect((await settlement(e.id)).json.escrow).toEqual({ configured: false });
    expect((await register(e.id)).status).toBe(503);
    expect((await settle(e.id)).status).toBe(503);
    app.deps.escrow = saved;
  });
});
