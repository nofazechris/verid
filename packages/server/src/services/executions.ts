import {
  CanonicalizationError,
  EvidenceError,
  InvalidTransitionError,
  assertTransition,
  computeEvidenceRoot,
  hashEvidenceContent,
  hashResult,
  hashTask,
  type EvidenceCommitmentInput,
  type EvidenceType,
  type ExecutionState,
  type JsonValue,
  type TaskDefinition,
} from "@verid/core";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type Ctx } from "../context";
import { agents, arcAnchors, evidence, executions, policies, receipts, settlements, validations } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { newId } from "../ids";
import { audit, cursorWhere, pageQuery, parse, runIdempotent, toPage, type Handled, type Tx } from "../util";

export const MAX_EVIDENCE_BYTES = 256 * 1024;
export const MAX_RESULT_BYTES = 1024 * 1024;
export const MAX_EVIDENCE_PER_EXECUTION = 500;

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]),
);

const EVIDENCE_TYPES = ["task", "tool_call", "tool_result", "model_output", "artifact"] as const; // `result`/`validation` are server-generated

export const createExecutionInput = z.object({
  agentId: z.string().min(1).max(100),
  policyId: z.string().min(1).max(100).optional(),
  task: z.object({
    description: z.string().trim().min(1).max(5000),
    parameters: z.record(jsonValue).optional(),
    outputSchema: z.record(jsonValue).optional(),
    acceptanceCriteria: z.array(z.string().max(500)).max(50).optional(),
    version: z.number().int().positive().optional(),
  }),
});

export const addEvidenceInput = z.object({
  type: z.enum(EVIDENCE_TYPES),
  content: jsonValue,
  contentReference: z.string().max(500).optional(),
  metadata: z.record(jsonValue).optional(),
});

export const completeInput = z.object({ result: jsonValue });
export const failInput = z.object({ reason: z.string().trim().min(1).max(500) });

const sizeOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null));

function hashOrInvalid<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CanonicalizationError) throw new ApiError("invalid_request", `content is not representable: ${e.message}`);
    throw e;
  }
}

/** Move an execution along the lifecycle. Illegal transitions become 409 invalid_state. */
export function move(from: ExecutionState, to: ExecutionState): void {
  try {
    assertTransition(from, to);
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new ApiError("invalid_state", `cannot move execution from '${from}' to '${to}'`);
    throw e;
  }
}

/** Load an execution FOR UPDATE, scoped to the caller's workspace. Serializes concurrent mutations. */
export async function lockExecution(tx: Tx, ctx: Ctx, id: string) {
  const [row] = await tx
    .select()
    .from(executions)
    .where(and(eq(executions.id, id), eq(executions.workspaceId, ctx.principal.workspaceId)))
    .for("update");
  if (!row) throw notFound("execution");
  return row;
}

export async function createExecution(ctx: Ctx, idemKey: string | undefined, raw: unknown): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const input = parse(createExecutionInput, raw);
  return runIdempotent(ctx, idemKey, "POST /executions", input, async (tx) => {
    const ws = ctx.principal.workspaceId;
    const [agent] = await tx.select().from(agents).where(and(eq(agents.id, input.agentId), eq(agents.workspaceId, ws)));
    if (!agent) throw new ApiError("invalid_request", "unknown agentId");
    if (agent.status !== "active") throw new ApiError("invalid_state", "agent is inactive");
    if (input.policyId) {
      const [p] = await tx.select({ id: policies.id }).from(policies).where(and(eq(policies.id, input.policyId), eq(policies.workspaceId, ws)));
      if (!p) throw new ApiError("invalid_request", "unknown policyId");
    }
    // The server computes the commitment. A client-supplied hash is never trusted.
    const taskHash = hashOrInvalid(() => hashTask(input.task as TaskDefinition));
    const now = ctx.deps.now();
    const id = newId("exe");
    const [row] = await tx
      .insert(executions)
      .values({
        id, workspaceId: ws, agentId: agent.id, policyId: input.policyId ?? null,
        taskDefinition: input.task as Record<string, unknown>, taskHash, status: "created", createdAt: now, updatedAt: now,
      })
      .returning();
    await audit(tx, ctx, "execution.created", { type: "execution", id });
    return { status: 201, body: { execution: row } };
  });
}

export async function startExecution(ctx: Ctx, id: string): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  return runIdempotent(ctx, undefined, "start", null, async (tx) => {
    const ex = await lockExecution(tx, ctx, id);
    move(ex.status, "running");
    const now = ctx.deps.now();
    const [row] = await tx.update(executions).set({ status: "running", startedAt: now, updatedAt: now }).where(eq(executions.id, id)).returning();
    await audit(tx, ctx, "execution.started", { type: "execution", id });
    return { status: 200, body: { execution: row } };
  });
}

export async function addEvidence(ctx: Ctx, id: string, idemKey: string | undefined, raw: unknown): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const input = parse(addEvidenceInput, raw);
  if (sizeOf(input.content) > MAX_EVIDENCE_BYTES) throw new ApiError("payload_too_large", `evidence content exceeds ${MAX_EVIDENCE_BYTES} bytes`);
  const contentHash = hashOrInvalid(() => hashEvidenceContent(input.content));
  return runIdempotent(ctx, idemKey, `POST /executions/${id}/evidence`, input, async (tx) => {
    const ex = await lockExecution(tx, ctx, id);
    if (ex.status !== "running") throw new ApiError("invalid_state", `evidence can only be added while the execution is running (is '${ex.status}')`);
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(evidence).where(eq(evidence.executionId, id));
    const seq = Number(n);
    if (seq >= MAX_EVIDENCE_PER_EXECUTION) throw new ApiError("payload_too_large", `at most ${MAX_EVIDENCE_PER_EXECUTION} evidence records per execution`);
    const now = ctx.deps.now();
    const [row] = await tx
      .insert(evidence)
      .values({
        id: newId("evd"), workspaceId: ctx.principal.workspaceId, executionId: id, sequenceNumber: seq, type: input.type,
        content: input.content, contentHash, contentReference: input.contentReference ?? null, metadata: input.metadata ?? null,
        // Committed timestamp is SERVER-assigned so a client cannot back-date evidence.
        evidenceTimestamp: now.toISOString(), createdAt: now,
      })
      .returning();
    return { status: 201, body: { evidence: stripContent(row!) } };
  });
}

type EvidenceRow = typeof evidence.$inferSelect;
const stripContent = ({ content: _c, ...rest }: EvidenceRow) => rest;

export function toCommitment(r: EvidenceRow): EvidenceCommitmentInput {
  return {
    executionId: r.executionId,
    sequenceNumber: r.sequenceNumber,
    type: r.type as EvidenceType,
    timestamp: r.evidenceTimestamp,
    contentHash: r.contentHash as `0x${string}`,
  };
}

/**
 * Finish the agent's work. The server appends the `result` evidence record,
 * computes the evidence root + result hash, and moves
 * running -> evidence_captured -> awaiting_validation.
 */
export async function completeExecution(ctx: Ctx, id: string, idemKey: string | undefined, raw: unknown): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const input = parse(completeInput, raw);
  if (sizeOf(input.result) > MAX_RESULT_BYTES) throw new ApiError("payload_too_large", `result exceeds ${MAX_RESULT_BYTES} bytes`);
  const resultHash = hashOrInvalid(() => hashResult(input.result));
  const resultContentHash = hashOrInvalid(() => hashEvidenceContent(input.result));
  return runIdempotent(ctx, idemKey, `POST /executions/${id}/complete`, input, async (tx) => {
    const ex = await lockExecution(tx, ctx, id);
    move(ex.status, "evidence_captured");
    const now = ctx.deps.now();

    const rows = await tx.select().from(evidence).where(eq(evidence.executionId, id)).orderBy(asc(evidence.sequenceNumber));
    if (rows.length >= MAX_EVIDENCE_PER_EXECUTION) throw new ApiError("payload_too_large", "evidence limit reached");
    const [resultEvidence] = await tx
      .insert(evidence)
      .values({
        id: newId("evd"), workspaceId: ctx.principal.workspaceId, executionId: id, sequenceNumber: rows.length, type: "result",
        content: input.result, contentHash: resultContentHash, contentReference: null, metadata: null,
        evidenceTimestamp: now.toISOString(), createdAt: now,
      })
      .returning();

    let root;
    try {
      root = computeEvidenceRoot([...rows, resultEvidence!].map(toCommitment));
    } catch (e) {
      if (e instanceof EvidenceError) throw new ApiError("internal", "evidence set is inconsistent");
      throw e;
    }
    move("evidence_captured", "awaiting_validation");
    const [row] = await tx
      .update(executions)
      .set({
        status: "awaiting_validation", result: input.result, resultHash, evidenceRoot: root.root, evidenceCount: root.count,
        completedAt: now, updatedAt: now,
      })
      .where(eq(executions.id, id))
      .returning();
    await audit(tx, ctx, "execution.completed", { type: "execution", id }, { evidenceCount: root.count });
    return { status: 200, body: { execution: row } };
  });
}

// -------------------------------------------------------------------------- reads

export const listExecutionsQuery = pageQuery.extend({
  agentId: z.string().max(100).optional(),
  status: z.enum(["created", "running", "evidence_captured", "awaiting_validation", "validated", "validation_failed", "anchoring", "anchored", "settling", "settled", "failed"]).optional(),
  validation: z.enum(["pass", "fail", "inconclusive"]).optional(),
  q: z.string().max(100).optional(),
});

export async function listExecutions(ctx: Ctx, rawQuery: unknown) {
  const q = parse(listExecutionsQuery, rawQuery);
  const ws = ctx.principal.workspaceId;
  const needle = q.q?.replace(/[%_\\]/g, "\\$&");
  const base = ctx.deps.db
    .select({ ex: executions, agentName: agents.name, validationStatus: validations.status, receiptId: receipts.id })
    .from(executions)
    .innerJoin(agents, eq(agents.id, executions.agentId))
    .leftJoin(validations, eq(validations.executionId, executions.id))
    .leftJoin(receipts, eq(receipts.executionId, executions.id))
    .where(
      and(
        eq(executions.workspaceId, ws),
        q.agentId ? eq(executions.agentId, q.agentId) : undefined,
        q.status ? eq(executions.status, q.status) : undefined,
        q.validation ? eq(validations.status, q.validation) : undefined,
        needle ? or(ilike(executions.id, `%${needle}%`), ilike(agents.name, `%${needle}%`)) : undefined,
        cursorWhere(q.cursor, executions.createdAt, executions.id),
      ),
    )
    .orderBy(desc(executions.createdAt), desc(executions.id))
    .limit(q.limit + 1);
  const rows = await base;
  const page = toPage(rows.map((r) => ({ ...r, id: r.ex.id, createdAt: r.ex.createdAt })), q.limit);
  return {
    nextCursor: page.nextCursor,
    data: page.data.map((r) => ({
      ...summarize(r.ex),
      agentName: r.agentName,
      validationStatus: r.validationStatus ?? null,
      receiptId: r.receiptId ?? null,
    })),
  };
}

/** Execution as shown in lists: no raw result (kept off the summary path). */
function summarize(ex: typeof executions.$inferSelect) {
  const { result: _r, taskDefinition, ...rest } = ex;
  return { ...rest, taskDescription: (taskDefinition as { description?: string }).description ?? "" };
}

export async function getExecution(ctx: Ctx, id: string) {
  const ws = ctx.principal.workspaceId;
  const [ex] = await ctx.deps.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.workspaceId, ws)));
  if (!ex) throw notFound("execution");
  const [[agent], [policy], [validation], [receipt], anchors, [settlement]] = await Promise.all([
    ctx.deps.db.select({ id: agents.id, slug: agents.slug, name: agents.name, version: agents.version }).from(agents).where(eq(agents.id, ex.agentId)),
    ex.policyId
      ? ctx.deps.db.select({ id: policies.id, slug: policies.slug, version: policies.version, policyHash: policies.policyHash }).from(policies).where(eq(policies.id, ex.policyId))
      : Promise.resolve([undefined]),
    ctx.deps.db.select().from(validations).where(eq(validations.executionId, id)),
    ctx.deps.db.select({ id: receipts.id, receiptHash: receipts.receiptHash }).from(receipts).where(eq(receipts.executionId, id)),
    ctx.deps.db.select().from(arcAnchors).where(eq(arcAnchors.executionId, id)).orderBy(desc(arcAnchors.createdAt)),
    ctx.deps.db.select().from(settlements).where(eq(settlements.executionId, id)),
  ]);
  return {
    ...ex,
    settlement: settlement ?? null,
    agent: agent ?? null,
    policy: policy ?? null,
    validation: validation ?? null,
    receipt: receipt ?? null,
    anchor: anchors[0] ?? null,
  };
}

const evidenceQuery = z.object({ includeContent: z.coerce.boolean().default(false) });

export async function listEvidence(ctx: Ctx, id: string, rawQuery: unknown) {
  const q = parse(evidenceQuery, rawQuery);
  const [ex] = await ctx.deps.db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.id, id), eq(executions.workspaceId, ctx.principal.workspaceId)));
  if (!ex) throw notFound("execution");
  // Raw private content is only revealed on explicit request, and never to viewers.
  if (q.includeContent) requireRole(ctx.principal, "developer");
  const rows = await ctx.deps.db.select().from(evidence).where(eq(evidence.executionId, id)).orderBy(asc(evidence.sequenceNumber));
  return { data: rows.map((r) => (q.includeContent ? r : stripContent(r))) };
}

/**
 * Mark an execution as failed because the AGENT itself crashed or gave up (an exception, a timeout, a tool that
 * never answered). This is different from a failed VALIDATION: no result exists to validate. It is terminal and
 * keeps the reason, so monitoring can show why a run never produced anything. Only a run that has not yet been
 * validated can fail this way.
 */
export async function failExecution(ctx: Ctx, id: string, raw: unknown): Promise<Handled> {
  requireRole(ctx.principal, "developer");
  const input = parse(failInput, raw);
  return runIdempotent(ctx, undefined, "fail", null, async (tx) => {
    const ex = await lockExecution(tx, ctx, id);
    if (!["created", "running", "evidence_captured", "awaiting_validation"].includes(ex.status)) {
      throw new ApiError("invalid_state", `only an execution that has not been validated yet can be marked failed (is '${ex.status}')`);
    }
    move(ex.status, "failed");
    const now = ctx.deps.now();
    const [row] = await tx
      .update(executions)
      .set({ status: "failed", error: { code: "agent_error", message: input.reason }, completedAt: now, updatedAt: now })
      .where(eq(executions.id, id))
      .returning();
    await audit(tx, ctx, "execution.failed", { type: "execution", id }, { reason: input.reason.slice(0, 200) });
    return { status: 200, body: { execution: row } };
  });
}
