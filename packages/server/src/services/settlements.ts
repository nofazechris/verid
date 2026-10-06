import { executionKey } from "@verid/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type Ctx, type OnchainEscrow, type TxResult } from "../context";
import { agents, executions, settlements } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { newId } from "../ids";
import { audit, cursorWhere, pageQuery, parse, toPage, type Handled, type Tx } from "../util";
import { lockExecution, move } from "./executions";
import { recordValidationOnchain } from "./receipts";

type SettlementRow = typeof settlements.$inferSelect;

async function loadExecution(ctx: Ctx, id: string) {
  const [ex] = await ctx.deps.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.workspaceId, ctx.principal.workspaceId)));
  if (!ex) throw notFound("execution");
  return ex;
}

async function loadSettlement(ctx: Ctx, executionId: string): Promise<SettlementRow | undefined> {
  const [row] = await ctx.deps.db.select().from(settlements).where(and(eq(settlements.executionId, executionId), eq(settlements.workspaceId, ctx.principal.workspaceId)));
  return row;
}

const chainError = (what: string, e: unknown) => new ApiError("unavailable", `${what}: ${e instanceof Error ? e.message : "chain error"}`);

/**
 * Settlement view for one execution: what the dashboard needs to fund the escrow from a wallet, what is
 * recorded here, and the LIVE on-chain state (the chain is the source of truth for funds).
 */
export async function getSettlement(ctx: Ctx, executionId: string) {
  const ex = await loadExecution(ctx, executionId);
  const settlement = (await loadSettlement(ctx, executionId)) ?? null;
  const gw = ctx.deps.escrow;
  if (!gw) {
    return { executionId, executionStatus: ex.status, escrow: { configured: false as const }, settlement, onchain: null, readiness: null };
  }
  let tokenAddress: string | null = null;
  let onchain: OnchainEscrow | null = null;
  let readiness: { release: boolean; refund: boolean } | null = null;
  let onchainError: string | undefined;
  try {
    tokenAddress = await gw.token();
    onchain = await gw.read(executionId);
    if (onchain.status === "funded") readiness = { release: await gw.canRelease(executionId), refund: await gw.canRefund(executionId) };
  } catch (e) {
    onchainError = e instanceof Error ? e.message : "chain error";
  }
  return {
    executionId,
    executionStatus: ex.status,
    escrow: {
      configured: true as const,
      escrowAddress: gw.target.escrowAddress,
      tokenAddress,
      chainId: gw.target.chainId,
      network: gw.target.network,
      executionKey: executionKey(executionId),
      tokenDecimals: 6,
    },
    settlement,
    onchain,
    readiness,
    ...(onchainError ? { onchainError } : {}),
  };
}

/**
 * Link an on-chain escrow to this execution. Nothing the client says is trusted: the payer, payee, amount and
 * deadline are READ FROM THE CHAIN for this execution's key. The escrow must already be funded (the payer
 * does `approve` + `create` from their own wallet; the server never holds payer keys).
 */
export async function registerSettlement(ctx: Ctx, executionId: string): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const gw = ctx.deps.escrow;
  if (!gw) throw new ApiError("unavailable", "settlement is not configured on this deployment (no escrow contract)");
  const ex = await loadExecution(ctx, executionId);
  if (ex.status === "failed") throw new ApiError("invalid_state", "a failed execution cannot be settled");

  let token: string;
  let oc: OnchainEscrow;
  try {
    token = await gw.token();
    oc = await gw.read(executionId);
  } catch (e) {
    throw chainError("could not read the escrow on-chain", e);
  }
  if (oc.status === "none") throw new ApiError("not_found", "no escrow has been funded on-chain for this execution yet");
  if (oc.status !== "funded") throw new ApiError("invalid_state", `the on-chain escrow is already ${oc.status}`);

  return ctx.deps.db.transaction(async (tx) => {
    await lockExecution(tx, ctx, executionId); // serialises concurrent registrations
    const [existing] = await tx.select().from(settlements).where(eq(settlements.executionId, executionId));
    if (existing) throw new ApiError("conflict", "a settlement is already registered for this execution");
    const now = ctx.deps.now();
    const [row] = await tx
      .insert(settlements)
      .values({
        id: newId("stl"), workspaceId: ctx.principal.workspaceId, executionId, requesterAddress: oc.payer, recipientAddress: oc.payee,
        amount: oc.amount, tokenAddress: token, escrowAddress: gw.target.escrowAddress, chainId: gw.target.chainId, deadline: oc.deadline,
        status: "escrowed", createdAt: now, updatedAt: now,
      })
      .returning();
    await audit(tx, ctx, "settlement.registered", { type: "settlement", id: row!.id }, { amount: oc.amount, payee: oc.payee });
    return { status: 201, body: { settlement: row } };
  });
}

// ----------------------------------------------------------------------- settle

async function finalizeRelease(tx: Tx, ctx: Ctx, executionId: string, txHash?: string) {
  const ex = await lockExecution(tx, ctx, executionId);
  const now = ctx.deps.now();
  if (ex.status === "anchored") {
    move("anchored", "settling");
    await tx.update(executions).set({ status: "settling", updatedAt: now }).where(eq(executions.id, ex.id));
  }
  if (ex.status === "anchored" || ex.status === "settling") {
    move("settling", "settled");
    await tx.update(executions).set({ status: "settled", updatedAt: now }).where(eq(executions.id, ex.id));
  }
  await tx.update(settlements).set({ status: "released", ...(txHash ? { releaseTxHash: txHash } : {}), updatedAt: now }).where(eq(settlements.executionId, executionId));
  await audit(tx, ctx, "settlement.released", { type: "execution", id: executionId }, txHash ? { txHash } : undefined);
}

async function finalizeRefund(tx: Tx, ctx: Ctx, executionId: string, txHash?: string) {
  const ex = await lockExecution(tx, ctx, executionId);
  const now = ctx.deps.now();
  if (ex.status === "settling") {
    move("settling", "anchored"); // the release never happened; the validated work itself is unchanged
    await tx.update(executions).set({ status: "anchored", updatedAt: now }).where(eq(executions.id, ex.id));
  }
  await tx.update(settlements).set({ status: "refunded", ...(txHash ? { refundTxHash: txHash } : {}), updatedAt: now }).where(eq(settlements.executionId, executionId));
  await audit(tx, ctx, "settlement.refunded", { type: "execution", id: executionId }, txHash ? { txHash } : undefined);
}

const SETTLEABLE = ["anchored", "settling", "validation_failed"] as const;

/**
 * Drive the escrow to its next legitimate state and mirror it here. Safe to call repeatedly:
 *  - the validation outcome is first written on-chain (idempotent);
 *  - the CONTRACT decides: release only after validation Pass AND anchor; refund only after a recorded Fail or
 *    an expired deadline; otherwise this reports `invalid_state` and moves nothing;
 *  - if someone else already released/refunded, this just syncs the database.
 * Settlement is reachable only from `anchored` (which is only reachable via `validated`), so a failed
 * validation can never release, and its record is never rewritten.
 */
export async function settle(ctx: Ctx, executionId: string): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const gw = ctx.deps.escrow;
  if (!gw) throw new ApiError("unavailable", "settlement is not configured on this deployment (no escrow contract)");
  const ex = await loadExecution(ctx, executionId);
  const settlement = await loadSettlement(ctx, executionId);
  if (!settlement) throw new ApiError("not_found", "no settlement is registered for this execution; fund an escrow and register it first");
  if (settlement.status === "released" || settlement.status === "refunded") {
    return { status: 200, body: { settlement, executionStatus: ex.status, alreadySettled: true } };
  }
  if (!(SETTLEABLE as readonly string[]).includes(ex.status)) {
    throw new ApiError("invalid_state", `only an anchored execution (or one with a failed validation) can be settled (is '${ex.status}')`);
  }

  // 1) make sure the on-chain validation record exists (the escrow reads it)
  await recordValidationOnchain(ctx, executionId);

  // 2) ask the chain what is allowed
  let oc: OnchainEscrow;
  try {
    oc = await gw.read(executionId);
  } catch (e) {
    throw chainError("could not read the escrow on-chain", e);
  }
  const done = async (): Promise<Handled> => {
    const fresh = await loadSettlement(ctx, executionId);
    const exNow = await loadExecution(ctx, executionId);
    return { status: 200, body: { settlement: fresh, executionStatus: exNow.status } };
  };

  if (oc.status === "released") {
    await ctx.deps.db.transaction((tx) => finalizeRelease(tx, ctx, executionId));
    return done();
  }
  if (oc.status === "refunded") {
    await ctx.deps.db.transaction((tx) => finalizeRefund(tx, ctx, executionId));
    return done();
  }
  if (oc.status === "none") throw new ApiError("invalid_state", "the on-chain escrow no longer exists for this execution");

  let releasable: boolean;
  let refundable = false;
  try {
    releasable = ex.status !== "validation_failed" && (await gw.canRelease(executionId));
    if (!releasable) refundable = await gw.canRefund(executionId);
  } catch (e) {
    throw chainError("could not evaluate the escrow on-chain", e);
  }
  if (!releasable && !refundable) {
    throw new ApiError("invalid_state", "the escrow cannot settle yet: it needs an on-chain validation Pass and an anchor to release, or a recorded failure / expired deadline to refund", {
      deadline: oc.deadline,
      executionStatus: ex.status,
    });
  }

  const action = releasable ? "release" : "refund";

  // 3) claim (release only): anchored -> settling
  if (releasable) {
    await ctx.deps.db.transaction(async (tx) => {
      const locked = await lockExecution(tx, ctx, executionId);
      if (locked.status === "anchored") {
        move("anchored", "settling");
        await tx.update(executions).set({ status: "settling", updatedAt: ctx.deps.now() }).where(eq(executions.id, locked.id));
        await audit(tx, ctx, "settlement.releasing", { type: "execution", id: executionId });
      } else if (locked.status !== "settling") {
        throw new ApiError("invalid_state", `cannot release while the execution is '${locked.status}'`);
      }
    });
  }

  // 4) talk to the chain (no DB transaction held)
  let outcome: TxResult;
  try {
    outcome = action === "release" ? await gw.release(executionId) : await gw.refund(executionId);
  } catch (e) {
    // A concurrent settle may have won the race; trust the chain.
    try {
      const again = await gw.read(executionId);
      if (again.status === "released") {
        await ctx.deps.db.transaction((tx) => finalizeRelease(tx, ctx, executionId));
        return done();
      }
      if (again.status === "refunded") {
        await ctx.deps.db.transaction((tx) => finalizeRefund(tx, ctx, executionId));
        return done();
      }
    } catch {
      /* fall through to the original error */
    }
    throw chainError(`could not ${action} the escrow right now`, e);
  }

  // 5) record the outcome
  if (outcome.status === "confirmed") {
    await ctx.deps.db.transaction((tx) => (action === "release" ? finalizeRelease(tx, ctx, executionId, outcome.txHash) : finalizeRefund(tx, ctx, executionId, outcome.txHash)));
    return done();
  }
  if (outcome.status === "reverted") {
    await ctx.deps.db.transaction(async (tx) => {
      const locked = await lockExecution(tx, ctx, executionId);
      if (locked.status === "settling") {
        move("settling", "anchored"); // safe to retry
        await tx.update(executions).set({ status: "anchored", updatedAt: ctx.deps.now() }).where(eq(executions.id, locked.id));
      }
      await audit(tx, ctx, `settlement.${action}_reverted`, { type: "execution", id: executionId }, { txHash: outcome.txHash });
    });
    throw new ApiError("unavailable", `the ${action} transaction reverted; nothing moved, retry shortly`, { txHash: outcome.txHash });
  }
  // pending: remember the hash; the next call re-reads the chain and finalizes
  await ctx.deps.db.transaction(async (tx) => {
    await tx
      .update(settlements)
      .set(action === "release" ? { releaseTxHash: outcome.txHash, updatedAt: ctx.deps.now() } : { refundTxHash: outcome.txHash, updatedAt: ctx.deps.now() })
      .where(eq(settlements.executionId, executionId));
    await audit(tx, ctx, `settlement.${action}_pending`, { type: "execution", id: executionId }, { txHash: outcome.txHash });
  });
  const fresh = await loadSettlement(ctx, executionId);
  return { status: 202, body: { settlement: fresh, executionStatus: (await loadExecution(ctx, executionId)).status, pending: true } };
}

// ------------------------------------------------------------------------- list

const listQuery = pageQuery.extend({ status: z.enum(["escrowed", "released", "refunded", "failed"]).optional() });

/**
 * Every escrow linked in this workspace, newest first, with totals per status (token base units; USDC = 6
 * decimals). This is the recorded view; the execution page shows the live on-chain state of any one escrow.
 */
export async function listSettlements(ctx: Ctx, rawQuery: unknown) {
  const q = parse(listQuery, rawQuery);
  const ws = ctx.principal.workspaceId;
  const [rows, totals] = await Promise.all([
    ctx.deps.db
      .select({ s: settlements, executionStatus: executions.status, agentName: agents.name })
      .from(settlements)
      .innerJoin(executions, eq(executions.id, settlements.executionId))
      .innerJoin(agents, eq(agents.id, executions.agentId))
      .where(and(eq(settlements.workspaceId, ws), q.status ? eq(settlements.status, q.status) : undefined, cursorWhere(q.cursor, settlements.createdAt, settlements.id)))
      .orderBy(desc(settlements.createdAt), desc(settlements.id))
      .limit(q.limit + 1),
    ctx.deps.db
      .select({ status: settlements.status, n: sql<string>`count(*)::text`, total: sql<string>`coalesce(sum(${settlements.amount}::numeric), 0)::text` })
      .from(settlements)
      .where(eq(settlements.workspaceId, ws))
      .groupBy(settlements.status),
  ]);
  const page = toPage(rows.map((r) => ({ ...r, id: r.s.id, createdAt: r.s.createdAt })), q.limit);
  const byStatus = Object.fromEntries(totals.map((t) => [t.status, { count: Number(t.n), amount: t.total.split(".")[0]! }]));
  return {
    nextCursor: page.nextCursor,
    totals: { escrowed: byStatus.escrowed ?? { count: 0, amount: "0" }, released: byStatus.released ?? { count: 0, amount: "0" }, refunded: byStatus.refunded ?? { count: 0, amount: "0" } },
    data: page.data.map((r) => ({ ...r.s, executionStatus: r.executionStatus, agentName: r.agentName })),
  };
}
