import { and, eq, isNull, or, gt } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type Ctx, type Principal, type Role } from "../context";
import type { Db } from "../db/client";
import { apiKeys, users, workspaceMembers, workspaces } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { generateApiKey, newId, parseApiKey, safeEqual, sha256Hex } from "../ids";
import { audit, parse } from "../util";

const slugRe = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const createWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(slugRe, "3-40 chars: lowercase letters, digits and hyphens"),
});

const isUniqueViolation = (e: unknown) => {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
};

/** Upsert a user by (lowercased) email. Called by the auth layer after a successful sign-in. */
export async function ensureUser(db: Db, now: Date, input: { email: string; name?: string | null; emailVerified?: boolean }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("invalid_request", "invalid email");
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing[0]) return existing[0];
  const [row] = await db
    .insert(users)
    .values({ id: newId("usr"), email, name: input.name ?? null, emailVerifiedAt: input.emailVerified ? now : null, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  return (await db.select().from(users).where(eq(users.email, email)))[0]!;
}

export async function createWorkspace(db: Db, now: Date, userId: string, raw: unknown) {
  const input = parse(createWorkspaceInput, raw);
  try {
    return await db.transaction(async (tx) => {
      const id = newId("ws");
      const [ws] = await tx
        .insert(workspaces)
        .values({ id, name: input.name, slug: input.slug, ownerUserId: userId, createdAt: now, updatedAt: now })
        .returning();
      await tx.insert(workspaceMembers).values({ id: newId("mem"), workspaceId: id, userId, role: "owner", createdAt: now });
      return ws!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError("conflict", "that workspace slug is already taken");
    throw e;
  }
}

export async function listWorkspacesForUser(db: Db, userId: string) {
  return db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId));
}

/**
 * Resolve the workspace + role for a signed-in user. The workspace reference
 * comes from the client (header) and is NEVER trusted: it is only honoured if
 * the user is a member. Without a reference, a user in exactly one workspace
 * gets it by default; otherwise a reference is required.
 */
export async function resolveMembership(db: Db, userId: string, ref?: string): Promise<Principal> {
  const mine = await listWorkspacesForUser(db, userId);
  const pick = ref ? mine.find((w) => w.id === ref || w.slug === ref) : mine.length === 1 ? mine[0] : undefined;
  if (!pick) {
    // Same error whether the workspace does not exist or the user is not a member.
    throw new ApiError(ref ? "forbidden" : "invalid_request", ref ? "not a member of that workspace" : "specify a workspace (X-Verid-Workspace header)");
  }
  return { kind: "user", id: userId, userId, workspaceId: pick.id, role: pick.role };
}

export async function getWorkspace(ctx: Ctx) {
  const [ws] = await ctx.deps.db.select().from(workspaces).where(eq(workspaces.id, ctx.principal.workspaceId));
  if (!ws) throw notFound("workspace");
  return { id: ws.id, name: ws.name, slug: ws.slug, role: ctx.principal.role, createdAt: ws.createdAt };
}

export async function listMembers(ctx: Ctx) {
  return ctx.deps.db
    .select({ userId: users.id, email: users.email, name: users.name, role: workspaceMembers.role, joinedAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.principal.workspaceId));
}

// --------------------------------------------------------------------- API keys

export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(80),
  /** API keys can never be admin/owner. */
  role: z.enum(["developer", "viewer"]).default("developer"),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

export async function createApiKey(ctx: Ctx, raw: unknown) {
  requireRole(ctx.principal, "admin");
  if (ctx.principal.kind !== "user") throw new ApiError("forbidden", "API keys can only be created by a signed-in user");
  const input = parse(createApiKeyInput, raw);
  const now = ctx.deps.now();
  const { key, prefix, hash } = generateApiKey();
  const id = newId("key");
  const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000) : null;
  await ctx.deps.db.transaction(async (tx) => {
    await tx.insert(apiKeys).values({
      id, workspaceId: ctx.principal.workspaceId, name: input.name, keyPrefix: prefix, keyHash: hash,
      role: input.role, createdByUserId: ctx.principal.userId ?? null, expiresAt, createdAt: now,
    });
    await audit(tx, ctx, "api_key.created", { type: "api_key", id }, { name: input.name, role: input.role });
  });
  // The full key is returned exactly once and cannot be recovered afterwards.
  return { id, name: input.name, role: input.role, prefix, key, expiresAt, createdAt: now };
}

export async function listApiKeys(ctx: Ctx) {
  requireRole(ctx.principal, "admin");
  const rows = await ctx.deps.db.select().from(apiKeys).where(eq(apiKeys.workspaceId, ctx.principal.workspaceId));
  return rows.map(({ keyHash: _h, ...safe }) => safe);
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  requireRole(ctx.principal, "admin");
  const now = ctx.deps.now();
  const res = await ctx.deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ctx.principal.workspaceId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (rows.length) await audit(tx, ctx, "api_key.revoked", { type: "api_key", id });
    return rows;
  });
  if (!res.length) throw notFound("API key");
  return { id, revoked: true };
}

/** Authenticate a bearer API key. Returns null for ANY failure (no oracle for which part was wrong). */
export async function authenticateApiKey(db: Db, token: string, now: Date): Promise<Principal | null> {
  const parsed = parseApiKey(token);
  if (!parsed) return null;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, parsed.prefix), isNull(apiKeys.revokedAt), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))));
  // Always hash + compare, even when no row matched, to keep timing uniform.
  const candidate = sha256Hex(parsed.secret);
  if (!row || !safeEqual(candidate, row.keyHash)) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));
  }
  return { kind: "api_key", id: row.id, workspaceId: row.workspaceId, role: row.role as Role };
}
