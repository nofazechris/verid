import { CanonicalizationError, canonicalize, hashPolicy, type PolicyDefinition } from "@verid/core";
import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type Ctx } from "../context";
import { agents, executions, policies } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { newId } from "../ids";
import { audit, cursorWhere, pageQuery, parse, toPage } from "../util";
import { agentMonitoring } from "./monitoring";

const isUniqueViolation = (e: unknown) =>
  ((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "23505";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-_]{0,62}$/, "lowercase letters, digits, '-' and '_'");
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "agent";

// ------------------------------------------------------------------------ agents

export const createAgentInput = z.object({
  slug: slug.optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  version: z.string().trim().min(1).max(40),
  capabilities: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  /** External identity reference (e.g. an ERC-8004 id). Recorded, NOT verified. */
  identityReference: z.string().max(300).optional(),
});

export const updateAgentInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).nullable(),
    version: z.string().trim().min(1).max(40),
    capabilities: z.array(z.string().trim().min(1).max(60)).max(50),
    identityReference: z.string().max(300).nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "no fields to update");

const VALIDATED_STATES = ["validated", "anchoring", "anchored", "settling", "settled"] as const;

async function agentStats(ctx: Ctx, ids: string[]) {
  if (!ids.length) return new Map<string, { executions: number; validated: number; lastExecutionAt: Date | null }>();
  const rows = await ctx.deps.db
    .select({
      agentId: executions.agentId,
      total: count(),
      validated: sql<number>`count(*) filter (where ${inArray(executions.status, [...VALIDATED_STATES])})`.mapWith(Number),
      last: max(executions.createdAt),
    })
    .from(executions)
    .where(and(eq(executions.workspaceId, ctx.principal.workspaceId), inArray(executions.agentId, ids)))
    .groupBy(executions.agentId);
  return new Map(rows.map((r) => [r.agentId, { executions: Number(r.total), validated: r.validated, lastExecutionAt: r.last }]));
}

export async function createAgent(ctx: Ctx, raw: unknown) {
  requireRole(ctx.principal, "developer");
  const input = parse(createAgentInput, raw);
  const now = ctx.deps.now();
  const id = newId("agt");
  try {
    return await ctx.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(agents)
        .values({
          id, workspaceId: ctx.principal.workspaceId, slug: input.slug ?? slugify(input.name), name: input.name,
          description: input.description ?? null, version: input.version, capabilities: input.capabilities,
          identityReference: input.identityReference ?? null, createdAt: now, updatedAt: now,
        })
        .returning();
      await audit(tx, ctx, "agent.created", { type: "agent", id });
      return { ...row!, executions: 0, validated: 0, lastExecutionAt: null };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError("conflict", "an agent with that slug already exists in this workspace");
    throw e;
  }
}

export async function listAgents(ctx: Ctx, rawQuery: unknown) {
  const q = parse(pageQuery.extend({ status: z.enum(["active", "inactive"]).optional() }), rawQuery);
  const rows = await ctx.deps.db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, ctx.principal.workspaceId), q.status ? eq(agents.status, q.status) : undefined, cursorWhere(q.cursor, agents.createdAt, agents.id)))
    .orderBy(desc(agents.createdAt), desc(agents.id))
    .limit(q.limit + 1);
  const page = toPage(rows, q.limit);
  const ids = page.data.map((a) => a.id);
  const [stats, mon] = await Promise.all([agentStats(ctx, ids), agentMonitoring(ctx, ids, false)]);
  return { ...page, data: page.data.map((a) => ({ ...a, ...(stats.get(a.id) ?? { executions: 0, validated: 0, lastExecutionAt: null }), monitoring: mon.get(a.id) })) };
}

export async function getAgent(ctx: Ctx, id: string) {
  const [row] = await ctx.deps.db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.workspaceId, ctx.principal.workspaceId)));
  if (!row) throw notFound("agent");
  const [stats, mon] = await Promise.all([agentStats(ctx, [id]), agentMonitoring(ctx, [id], true)]);
  return { ...row, ...(stats.get(id) ?? { executions: 0, validated: 0, lastExecutionAt: null }), monitoring: mon.get(id) };
}

export async function updateAgent(ctx: Ctx, id: string, raw: unknown) {
  requireRole(ctx.principal, "developer");
  const input = parse(updateAgentInput, raw);
  const now = ctx.deps.now();
  const rows = await ctx.deps.db.transaction(async (tx) => {
    const r = await tx
      .update(agents)
      .set({ ...input, updatedAt: now })
      .where(and(eq(agents.id, id), eq(agents.workspaceId, ctx.principal.workspaceId)))
      .returning({ id: agents.id });
    if (r.length) await audit(tx, ctx, "agent.updated", { type: "agent", id }, { fields: Object.keys(input) });
    return r;
  });
  if (!rows.length) throw notFound("agent");
  return getAgent(ctx, id);
}

// ---------------------------------------------------------------------- policies

export const createPolicyInput = z.object({
  slug,
  name: z.string().trim().min(1).max(100),
  rules: z.record(z.unknown()),
});

export const newPolicyVersionInput = z
  .object({ name: z.string().trim().min(1).max(100), rules: z.record(z.unknown()) })
  .partial()
  .refine((o) => o.name !== undefined || o.rules !== undefined, "provide name and/or rules");

function definitionHash(def: PolicyDefinition): string {
  try {
    canonicalize(def);
    return hashPolicy(def);
  } catch (e) {
    if (e instanceof CanonicalizationError) throw new ApiError("invalid_request", `policy rules are not representable: ${e.message}`);
    throw e;
  }
}

export async function createPolicy(ctx: Ctx, raw: unknown) {
  requireRole(ctx.principal, "developer");
  const input = parse(createPolicyInput, raw);
  const def: PolicyDefinition = { id: input.slug, version: 1, rules: input.rules as PolicyDefinition["rules"] };
  const policyHash = definitionHash(def);
  const id = newId("pol");
  try {
    return await ctx.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(policies)
        .values({ id, workspaceId: ctx.principal.workspaceId, slug: input.slug, name: input.name, version: 1, definition: def as unknown as Record<string, unknown>, policyHash, createdAt: ctx.deps.now() })
        .returning();
      await audit(tx, ctx, "policy.created", { type: "policy", id });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError("conflict", "a policy with that slug already exists");
    throw e;
  }
}

/** Policies are immutable: "editing" creates version N+1 and leaves every earlier version (and every execution bound to it) untouched. */
export async function createPolicyVersion(ctx: Ctx, id: string, raw: unknown) {
  requireRole(ctx.principal, "developer");
  const input = parse(newPolicyVersionInput, raw);
  const [base] = await ctx.deps.db.select().from(policies).where(and(eq(policies.id, id), eq(policies.workspaceId, ctx.principal.workspaceId)));
  if (!base) throw notFound("policy");
  const baseDef = base.definition as unknown as PolicyDefinition;
  const nextId = newId("pol");
  return ctx.deps.db.transaction(async (tx) => {
    const [{ latest } = { latest: base.version }] = await tx
      .select({ latest: max(policies.version) })
      .from(policies)
      .where(and(eq(policies.workspaceId, ctx.principal.workspaceId), eq(policies.slug, base.slug)));
    const version = Number(latest ?? base.version) + 1;
    const def: PolicyDefinition = { id: base.slug, version, rules: (input.rules ?? baseDef.rules) as PolicyDefinition["rules"] };
    const [row] = await tx
      .insert(policies)
      .values({ id: nextId, workspaceId: ctx.principal.workspaceId, slug: base.slug, name: input.name ?? base.name, version, definition: def as unknown as Record<string, unknown>, policyHash: definitionHash(def), createdAt: ctx.deps.now() })
      .returning();
    await audit(tx, ctx, "policy.version_created", { type: "policy", id: nextId }, { slug: base.slug, version });
    return row!;
  });
}

export async function listPolicies(ctx: Ctx, rawQuery: unknown) {
  const q = parse(pageQuery.extend({ allVersions: z.coerce.boolean().default(false) }), rawQuery);
  const ws = ctx.principal.workspaceId;
  const latestOnly = q.allVersions
    ? undefined
    : sql`${policies.version} = (select max(p2.version) from policies p2 where p2.workspace_id = ${policies.workspaceId} and p2.slug = ${policies.slug})`;
  const rows = await ctx.deps.db
    .select()
    .from(policies)
    .where(and(eq(policies.workspaceId, ws), latestOnly, cursorWhere(q.cursor, policies.createdAt, policies.id)))
    .orderBy(desc(policies.createdAt), desc(policies.id))
    .limit(q.limit + 1);
  const page = toPage(rows, q.limit);
  const refs = page.data.length
    ? await ctx.deps.db
        .select({ policyId: executions.policyId, n: count() })
        .from(executions)
        .where(and(eq(executions.workspaceId, ws), inArray(executions.policyId, page.data.map((p) => p.id))))
        .groupBy(executions.policyId)
    : [];
  const byId = new Map(refs.map((r) => [r.policyId, Number(r.n)]));
  return { ...page, data: page.data.map((p) => ({ ...p, executionCount: byId.get(p.id) ?? 0 })) };
}

export async function getPolicy(ctx: Ctx, id: string) {
  const [row] = await ctx.deps.db.select().from(policies).where(and(eq(policies.id, id), eq(policies.workspaceId, ctx.principal.workspaceId)));
  if (!row) throw notFound("policy");
  const versions = await ctx.deps.db
    .select({ id: policies.id, version: policies.version, policyHash: policies.policyHash, createdAt: policies.createdAt })
    .from(policies)
    .where(and(eq(policies.workspaceId, ctx.principal.workspaceId), eq(policies.slug, row.slug)))
    .orderBy(desc(policies.version));
  const [{ n } = { n: 0 }] = await ctx.deps.db.select({ n: count() }).from(executions).where(and(eq(executions.workspaceId, ctx.principal.workspaceId), eq(executions.policyId, id)));
  return { ...row, executionCount: Number(n), versions };
}

/**
 * Delete an agent that has NEVER run. An agent with recorded executions cannot be deleted: its history (evidence,
 * validations, receipts, anchors) is a permanent record that other people may be relying on. Archive it instead
 * (PATCH status "inactive"), which keeps the history and stops it showing as active.
 */
export async function deleteAgent(ctx: Ctx, id: string) {
  requireRole(ctx.principal, "developer");
  return ctx.deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(agents).where(and(eq(agents.id, id), eq(agents.workspaceId, ctx.principal.workspaceId))).for("update");
    if (!row) throw notFound("agent");
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(executions).where(eq(executions.agentId, id));
    if (Number(n) > 0) {
      throw new ApiError("conflict", `this agent has ${n} recorded execution${Number(n) === 1 ? "" : "s"}, which are a permanent record, so it cannot be deleted. Archive it instead.`, { executions: Number(n), archive: true });
    }
    await tx.delete(agents).where(eq(agents.id, id));
    await audit(tx, ctx, "agent.deleted", { type: "agent", id }, { slug: row.slug });
    return { deleted: true, id };
  });
}
