import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Ctx, Deps } from "../context";
import { agents, apiKeys, arcAnchors, auditEvents, customValidators, executions, settlements, validations } from "../db/schema";
import { cursorWhere, pageQuery, parse, toPage } from "../util";
import { VALIDATORS } from "../validator-registry";

const VALIDATED = ["validated", "anchoring", "anchored", "settling", "settled"] as const;

/** Dashboard metrics. Every number is derived from this workspace's real rows — nothing is fabricated. */
export async function overview(ctx: Ctx) {
  const ws = ctx.principal.workspaceId;
  const db = ctx.deps.db;

  const [[totals], [vstats], [settled], recentExecutions, recentFailures, recentAnchors] = await Promise.all([
    db.select({ total: count() }).from(executions).where(eq(executions.workspaceId, ws)),
    db
      .select({
        validated: sql<number>`count(*) filter (where ${inArray(validations.status, ["pass"])})`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${inArray(validations.status, ["fail", "inconclusive"])})`.mapWith(Number),
      })
      .from(validations)
      .where(eq(validations.workspaceId, ws)),
    db
      .select({ total: sql<string>`coalesce(sum(${settlements.amount}::numeric) filter (where ${settlements.status} = 'released'), 0)::text` })
      .from(settlements)
      .where(eq(settlements.workspaceId, ws)),
    db
      .select({ id: executions.id, status: executions.status, createdAt: executions.createdAt, agentName: agents.name, taskHash: executions.taskHash })
      .from(executions)
      .innerJoin(agents, eq(agents.id, executions.agentId))
      .where(eq(executions.workspaceId, ws))
      .orderBy(desc(executions.createdAt))
      .limit(6),
    db
      .select({ executionId: validations.executionId, status: validations.status, validatorId: validations.validatorId, validatedAt: validations.validatedAt })
      .from(validations)
      .where(and(eq(validations.workspaceId, ws), inArray(validations.status, ["fail", "inconclusive"])))
      .orderBy(desc(validations.validatedAt))
      .limit(5),
    db
      .select({ receiptId: arcAnchors.receiptId, executionId: arcAnchors.executionId, status: arcAnchors.status, transactionHash: arcAnchors.transactionHash, blockNumber: arcAnchors.blockNumber, createdAt: arcAnchors.createdAt })
      .from(arcAnchors)
      .where(eq(arcAnchors.workspaceId, ws))
      .orderBy(desc(arcAnchors.createdAt))
      .limit(5),
  ]);

  const [{ n: validatedExecutions } = { n: 0 }] = await db
    .select({ n: count() })
    .from(executions)
    .where(and(eq(executions.workspaceId, ws), inArray(executions.status, [...VALIDATED])));

  const decided = (vstats?.validated ?? 0) + (vstats?.failed ?? 0);
  return {
    totalExecutions: Number(totals?.total ?? 0),
    validatedExecutions: Number(validatedExecutions),
    validationPassRate: decided === 0 ? null : (vstats?.validated ?? 0) / decided,
    /** Sum of released escrow settlements, in USDC base units (6 decimals). "0" until settlement ships. */
    usdcSettledBaseUnits: settled?.total ?? "0",
    recentExecutions,
    recentFailedValidations: recentFailures,
    recentAnchors,
  };
}

export function listValidators() {
  return VALIDATORS.map((v) => ({
    origin: "verid" as const,
    id: v.id, version: v.version, name: v.name, method: v.method, description: v.description, supportedTasks: v.supportedTasks, rules: v.rules,
  }));
}

export async function validatorHistory(ctx: Ctx, validatorId: string) {
  const rows = await ctx.deps.db
    .select({ status: validations.status, n: count() })
    .from(validations)
    .where(and(eq(validations.workspaceId, ctx.principal.workspaceId), eq(validations.validatorId, validatorId)))
    .groupBy(validations.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/**
 * Health, with the backend and the chain reported SEPARATELY (PRD §27.3): an Arc/RPC
 * problem must never look like a VERID outage, or vice versa.
 */
export async function networkStatus(deps: Deps) {
  let database: "ok" | "down" = "ok";
  try {
    await deps.db.execute(sql`select 1`);
  } catch {
    database = "down";
  }
  let chain:
    | { status: "not_configured" }
    | { status: "ok"; chainId: number; blockNumber: number; network: string; registryAddress: string }
    | { status: "unavailable"; network: string; registryAddress: string };
  if (!deps.anchorer || !deps.chainStatus) {
    chain = { status: "not_configured" };
  } else {
    const { network, registryAddress } = deps.anchorer.target;
    try {
      const s = await deps.chainStatus();
      chain = { status: "ok", chainId: s.chainId, blockNumber: s.blockNumber, network, registryAddress };
    } catch {
      chain = { status: "unavailable", network, registryAddress };
    }
  }
  return { backend: { status: "ok" as const, database }, chain };
}

/** Real workspace activity (from the audit log). Never fabricated, never contains secrets or private content. */
export async function activity(ctx: Ctx, rawQuery: unknown) {
  const q = parse(pageQuery, rawQuery);
  const rows = await ctx.deps.db
    .select({
      id: auditEvents.id, action: auditEvents.action, actorType: auditEvents.actorType, targetType: auditEvents.targetType,
      targetId: auditEvents.targetId, metadata: auditEvents.metadata, createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.workspaceId, ctx.principal.workspaceId), cursorWhere(q.cursor, auditEvents.createdAt, auditEvents.id)))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(q.limit + 1);
  return toPage(rows, q.limit);
}

/**
 * What this workspace has actually done so far, for the getting-started walkthrough. Every flag comes from real rows,
 * so a step is only ticked once it truly happened (a key exists, an agent exists, a run was recorded, and so on).
 */
export async function onboarding(ctx: Ctx) {
  const ws = ctx.principal.workspaceId;
  const db = ctx.deps.db;
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const [keys, agentCount, validatorCount, runs, finished, passed, anchored, escrows] = await Promise.all([
    n(db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.workspaceId, ws), sql`${apiKeys.revokedAt} is null`))),
    n(db.select({ n: count() }).from(agents).where(eq(agents.workspaceId, ws))),
    n(db.select({ n: sql<number>`count(distinct ${customValidators.slug})` }).from(customValidators).where(eq(customValidators.workspaceId, ws))),
    n(db.select({ n: count() }).from(executions).where(eq(executions.workspaceId, ws))),
    n(db.select({ n: count() }).from(validations).where(eq(validations.workspaceId, ws))),
    n(db.select({ n: count() }).from(validations).where(and(eq(validations.workspaceId, ws), eq(validations.status, "pass")))),
    n(db.select({ n: count() }).from(arcAnchors).where(and(eq(arcAnchors.workspaceId, ws), eq(arcAnchors.status, "confirmed")))),
    n(db.select({ n: count() }).from(settlements).where(eq(settlements.workspaceId, ws))),
  ]);
  const [latest] = await db.select({ id: executions.id, status: executions.status, createdAt: executions.createdAt }).from(executions).where(eq(executions.workspaceId, ws)).orderBy(desc(executions.createdAt)).limit(1);
  return {
    apiKeys: keys, agents: agentCount, customValidators: validatorCount, executions: runs, validated: finished, passed, anchored, escrows,
    latestExecution: latest ?? null,
    chainConfigured: !!ctx.deps.anchorer,
    escrowConfigured: !!ctx.deps.escrow,
  };
}
