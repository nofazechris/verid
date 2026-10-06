import {
  buildReceipt,
  hashValidationResult,
  verifyReceipt,
  type Hex32,
  type PolicyDefinition,
  type Receipt,
  type ValidationResult,
  type VerificationBundle,
} from "@verid/core";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type Ctx } from "../context";
import { agents, arcAnchors, evidence, executions, policies, receipts, validations } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { newId } from "../ids";
import { VALIDATORS } from "../validator-registry";
import { resolveValidator } from "./validators";
import { audit, cursorWhere, pageQuery, parse, runIdempotent, toPage, type Handled } from "../util";
import { lockExecution, move, toCommitment } from "./executions";

// ------------------------------------------------------------------- validation

export const runValidationInput = z.object({
  executionId: z.string().min(1).max(100),
  validatorId: z.string().min(1).max(100),
});

/**
 * Run a validator server-side over the recorded evidence and result. The
 * outcome is computed here, never accepted from a client. A pass moves the
 * execution to `validated`; fail/inconclusive move it to the terminal,
 * preserved `validation_failed` state.
 */
export async function runValidation(ctx: Ctx, idemKey: string | undefined, raw: unknown): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const input = parse(runValidationInput, raw);
  const validator = await resolveValidator(ctx, input.validatorId);
  if (!validator) throw new ApiError("invalid_request", `unknown validator '${input.validatorId}'`, { available: VALIDATORS.map((v) => v.id), hint: "workspace validators are addressed as custom:<slug> or custom:<slug>@<version>" });

  return runIdempotent(ctx, idemKey, "POST /validations", input, async (tx) => {
    const ex = await lockExecution(tx, ctx, input.executionId);
    if (ex.status !== "awaiting_validation") {
      throw new ApiError("invalid_state", `execution must be 'awaiting_validation' to validate (is '${ex.status}')`);
    }
    const rows = await tx.select().from(evidence).where(eq(evidence.executionId, ex.id)).orderBy(evidence.sequenceNumber);
    const params = ((ex.taskDefinition as { parameters?: Record<string, unknown> }).parameters ?? {}) as Record<string, unknown>;
    const now = ctx.deps.now();

    const result: ValidationResult = validator.run({
      executionId: ex.id,
      result: ex.result,
      evidence: rows.map(toCommitment),
      taskParameters: params,
      validatedAt: now.toISOString(),
    });
    const resultHash = hashValidationResult(result);

    const [row] = await tx
      .insert(validations)
      .values({
        id: newId("val"), workspaceId: ctx.principal.workspaceId, executionId: ex.id, validatorId: result.validatorId,
        validatorVersion: result.validatorVersion, status: result.status, checks: result.checks, result, resultHash, validatedAt: now,
      })
      .returning();

    const next = result.status === "pass" ? "validated" : "validation_failed";
    move(ex.status, next);
    await tx.update(executions).set({ status: next, updatedAt: now }).where(eq(executions.id, ex.id));
    await audit(tx, ctx, "validation.recorded", { type: "validation", id: row!.id }, { status: result.status, validator: `${result.validatorId}@${result.validatorVersion}` });
    return { status: 201, body: { validation: row, executionStatus: next } };
  });
}

export async function getValidation(ctx: Ctx, id: string) {
  const [row] = await ctx.deps.db.select().from(validations).where(and(eq(validations.id, id), eq(validations.workspaceId, ctx.principal.workspaceId)));
  if (!row) throw notFound("validation");
  return row;
}

// --------------------------------------------------------------------- receipts

export const createReceiptInput = z.object({ executionId: z.string().min(1).max(100) });

type ReceiptRow = typeof receipts.$inferSelect;
type AnchorRow = typeof arcAnchors.$inferSelect;

/** The stored receipt is immutable; the confirmed anchor is merged in at read time. */
export function withAnchor(row: ReceiptRow, anchor: AnchorRow | undefined): Receipt {
  const base = row.receiptData as Receipt;
  if (anchor && anchor.status === "confirmed" && anchor.transactionHash) {
    return {
      ...base,
      anchor: {
        network: anchor.network,
        chainId: anchor.chainId,
        registryAddress: anchor.contractAddress,
        transactionHash: anchor.transactionHash as Hex32,
        ...(anchor.blockNumber !== null ? { blockNumber: anchor.blockNumber } : {}),
      },
    };
  }
  return base;
}

/** Idempotent: an execution has at most one receipt; asking again returns it. */
export async function createReceipt(ctx: Ctx, raw: unknown): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const input = parse(createReceiptInput, raw);
  return runIdempotent(ctx, undefined, "POST /receipts", null, async (tx) => {
    const ex = await lockExecution(tx, ctx, input.executionId);
    const [existing] = await tx.select().from(receipts).where(eq(receipts.executionId, ex.id));
    if (existing) return { status: 200, body: { receipt: existing.receiptData } };

    const [validation] = await tx.select().from(validations).where(eq(validations.executionId, ex.id));
    if (!validation || !ex.evidenceRoot || ex.evidenceCount === null || !ex.resultHash) {
      throw new ApiError("invalid_state", "a receipt requires a completed and validated execution");
    }
    const [[agent], policyRows] = await Promise.all([
      tx.select().from(agents).where(eq(agents.id, ex.agentId)),
      ex.policyId ? tx.select().from(policies).where(eq(policies.id, ex.policyId)) : Promise.resolve([]),
    ]);
    const policy = policyRows[0];
    const now = ctx.deps.now();
    const id = newId("rcpt");

    const receipt = buildReceipt({
      receiptId: id,
      executionId: ex.id,
      agent: { id: agent!.slug, version: agent!.version },
      task: { hash: ex.taskHash as Hex32 },
      ...(policy ? { policy: { id: policy.slug, hash: policy.policyHash as Hex32 } } : {}),
      evidence: { root: ex.evidenceRoot as Hex32, count: ex.evidenceCount },
      result: { hash: ex.resultHash as Hex32 },
      validation: {
        status: validation.status,
        validatorId: validation.validatorId,
        validatorVersion: validation.validatorVersion,
        resultHash: validation.resultHash as Hex32,
      },
      timestamps: { createdAt: now.toISOString(), ...(ex.completedAt ? { completedAt: ex.completedAt.toISOString() } : {}) },
    });
    await tx.insert(receipts).values({
      id, workspaceId: ctx.principal.workspaceId, executionId: ex.id, schemaVersion: receipt.schemaVersion,
      receiptData: receipt, receiptHash: receipt.receiptHash, createdAt: now,
    });
    await audit(tx, ctx, "receipt.created", { type: "receipt", id });
    return { status: 201, body: { receipt } };
  });
}

async function loadReceipt(ctx: Ctx, id: string) {
  const [row] = await ctx.deps.db.select().from(receipts).where(and(eq(receipts.id, id), eq(receipts.workspaceId, ctx.principal.workspaceId)));
  if (!row) throw notFound("receipt");
  const [anchor] = await ctx.deps.db.select().from(arcAnchors).where(eq(arcAnchors.receiptId, id)).orderBy(desc(arcAnchors.createdAt));
  return { row, anchor };
}

export async function getReceipt(ctx: Ctx, id: string) {
  const { row, anchor } = await loadReceipt(ctx, id);
  return { receipt: withAnchor(row, anchor), anchor: anchor ?? null, executionId: row.executionId };
}

export async function listReceipts(ctx: Ctx, rawQuery: unknown) {
  const q = parse(pageQuery, rawQuery);
  const rows = await ctx.deps.db
    .select({ r: receipts, status: validations.status, exStatus: executions.status })
    .from(receipts)
    .innerJoin(executions, eq(executions.id, receipts.executionId))
    .leftJoin(validations, eq(validations.executionId, receipts.executionId))
    .where(and(eq(receipts.workspaceId, ctx.principal.workspaceId), cursorWhere(q.cursor, receipts.createdAt, receipts.id)))
    .orderBy(desc(receipts.createdAt), desc(receipts.id))
    .limit(q.limit + 1);
  const page = toPage(rows.map((r) => ({ ...r, id: r.r.id, createdAt: r.r.createdAt })), q.limit);
  return {
    nextCursor: page.nextCursor,
    data: page.data.map((r) => ({
      id: r.r.id, executionId: r.r.executionId, receiptHash: r.r.receiptHash, createdAt: r.r.createdAt,
      validationStatus: r.status ?? null, executionStatus: r.exStatus,
    })),
  };
}

// --------------------------------------------------------------------- anchoring

/**
 * Write this execution's validation outcome to the on-chain VeridValidation contract (idempotent; a no-op when
 * no recorder is configured). The escrow reads this record, so it must exist before funds can release or be
 * refunded early. A pending/reverted write is surfaced as `unavailable` so the caller can simply retry.
 */
export async function recordValidationOnchain(ctx: Ctx, executionId: string): Promise<void> {
  const recorder = ctx.deps.validationRecorder;
  if (!recorder) return;
  const [v] = await ctx.deps.db.select().from(validations).where(and(eq(validations.executionId, executionId), eq(validations.workspaceId, ctx.principal.workspaceId)));
  if (!v) throw new ApiError("invalid_state", "the execution has no validation to record");
  let out;
  try {
    out = await recorder.record({ executionId, status: v.status, resultHash: v.resultHash as Hex32, validatorVersion: v.validatorVersion });
  } catch (e) {
    throw new ApiError("unavailable", `could not record the validation on-chain right now: ${e instanceof Error ? e.message : "chain error"}`);
  }
  if (out.status !== "confirmed") throw new ApiError("unavailable", `the on-chain validation record is ${out.status}; retry shortly`);
}

/**
 * Anchor a receipt's commitments on Arc. Safe to call repeatedly:
 *  - validated      -> claim `anchoring`, submit, record the outcome;
 *  - anchoring      -> re-check/resubmit (the registry write is idempotent);
 *  - anchored       -> returns the existing anchor, sends nothing.
 * Only a PASSING validation can reach `validated`, so failed validations can
 * never be anchored. The network call happens OUTSIDE any DB transaction.
 */
export async function anchorReceipt(ctx: Ctx, id: string): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const { row, anchor: prior } = await loadReceipt(ctx, id);
  const anchorer = ctx.deps.anchorer;
  if (!anchorer) throw new ApiError("unavailable", "anchoring is not configured on this deployment (no Arc network/relayer)");

  // 1) claim the transition (short transaction)
  const claim = await ctx.deps.db.transaction(async (tx) => {
    const ex = await lockExecution(tx, ctx, row.executionId);
    if (ex.status === "anchored") return { done: true as const };
    if (ex.status === "validated") {
      move("validated", "anchoring");
      await tx.update(executions).set({ status: "anchoring", updatedAt: ctx.deps.now() }).where(eq(executions.id, ex.id));
    } else if (ex.status !== "anchoring") {
      throw new ApiError("invalid_state", `only a validated execution can be anchored (is '${ex.status}')`);
    }
    const anchorId = prior && prior.status === "submitted" ? prior.id : newId("anc");
    if (!prior || prior.status !== "submitted") {
      await tx.insert(arcAnchors).values({
        id: anchorId, workspaceId: ctx.principal.workspaceId, executionId: ex.id, receiptId: id, network: anchorer.target.network,
        chainId: anchorer.target.chainId, contractAddress: anchorer.target.registryAddress, status: "submitted", submittedAt: ctx.deps.now(),
      });
    }
    await audit(tx, ctx, "anchor.submitting", { type: "receipt", id });
    return { done: false as const, anchorId, executionId: ex.id };
  });
  if (claim.done) {
    const { row: r, anchor } = await loadReceipt(ctx, id);
    return { status: 200, body: { receipt: withAnchor(r, anchor), anchor: anchor ?? null, alreadyAnchored: true } };
  }

  // 2) talk to the chain (no DB transaction held). The validation record goes first: it is idempotent, and
  //    a settlement escrow needs it alongside the anchor.
  await recordValidationOnchain(ctx, row.executionId);
  let outcome;
  try {
    outcome = await anchorer.submit(row.receiptData as Receipt);
  } catch (e) {
    // The execution stays `anchoring`; a retry is safe because the registry write is idempotent.
    throw new ApiError("unavailable", `could not anchor right now: ${e instanceof Error ? e.message : "chain error"}`);
  }

  // 3) record the outcome
  const now = ctx.deps.now();
  await ctx.deps.db.transaction(async (tx) => {
    const ex = await lockExecution(tx, ctx, claim.executionId);
    if (outcome.status === "confirmed") {
      await tx.update(arcAnchors).set({ status: "confirmed", transactionHash: outcome.txHash, blockNumber: outcome.blockNumber ?? null, confirmedAt: now }).where(eq(arcAnchors.id, claim.anchorId));
      move(ex.status, "anchored");
      await tx.update(executions).set({ status: "anchored", updatedAt: now }).where(eq(executions.id, ex.id));
      await audit(tx, ctx, "anchor.confirmed", { type: "receipt", id }, { txHash: outcome.txHash });
    } else if (outcome.status === "reverted") {
      await tx.update(arcAnchors).set({ status: "reverted", transactionHash: outcome.txHash }).where(eq(arcAnchors.id, claim.anchorId));
      move(ex.status, "validated"); // safe to retry
      await tx.update(executions).set({ status: "validated", updatedAt: now }).where(eq(executions.id, ex.id));
      await audit(tx, ctx, "anchor.reverted", { type: "receipt", id }, { txHash: outcome.txHash });
    } else {
      await tx.update(arcAnchors).set({ transactionHash: outcome.txHash }).where(eq(arcAnchors.id, claim.anchorId));
      await audit(tx, ctx, "anchor.pending", { type: "receipt", id }, { txHash: outcome.txHash });
    }
  });

  const { row: r, anchor } = await loadReceipt(ctx, id);
  return { status: outcome.status === "confirmed" ? 200 : 202, body: { receipt: withAnchor(r, anchor), anchor: anchor ?? null, alreadyAnchored: false } };
}

// ------------------------------------------------------------------- public view

/**
 * Public receipt view: ONLY what is already public by construction (commitments,
 * validator identity, anchor) plus a verification report. No task text, result,
 * evidence content, check explanations or details — those may contain private data.
 */
export async function getPublicReceipt(deps: Ctx["deps"], id: string) {
  const [row] = await deps.db.select().from(receipts).where(eq(receipts.id, id));
  if (!row) throw notFound("receipt");
  const [[anchor], [validation], [ex]] = await Promise.all([
    deps.db.select().from(arcAnchors).where(eq(arcAnchors.receiptId, id)).orderBy(desc(arcAnchors.createdAt)),
    deps.db.select().from(validations).where(eq(validations.executionId, row.executionId)),
    deps.db.select({ status: executions.status }).from(executions).where(eq(executions.id, row.executionId)),
  ]);
  const receipt = withAnchor(row, anchor);
  const verification = await verifyReceipt(receipt, { chain: deps.chain });
  return {
    receipt,
    executionStatus: ex?.status ?? null,
    validation: validation
      ? {
          status: validation.status,
          validatorId: validation.validatorId,
          validatorVersion: validation.validatorVersion,
          checks: (validation.checks as { id: string; description: string; ok: boolean; determinate: boolean }[]).map((c) => ({
            id: c.id, description: c.description, ok: c.ok, determinate: c.determinate,
          })),
        }
      : null,
    anchor: anchor ? { status: anchor.status, network: anchor.network, chainId: anchor.chainId, transactionHash: anchor.transactionHash, blockNumber: anchor.blockNumber } : null,
    verification,
  };
}

export const verifyInput = z.object({ receipt: z.unknown(), bundle: z.unknown().optional() });
const MAX_VERIFY_BYTES = 2 * 1024 * 1024;

/** Stateless verification of a user-supplied receipt (+ optional bundle). Public but rate-limited. */
export async function verifySupplied(deps: Ctx["deps"], raw: unknown) {
  const input = parse(verifyInput, raw);
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_VERIFY_BYTES) throw new ApiError("payload_too_large", "receipt/bundle too large");
  return verifyReceipt(input.receipt, { bundle: input.bundle as VerificationBundle | undefined, chain: deps.chain });
}

export type { PolicyDefinition };
