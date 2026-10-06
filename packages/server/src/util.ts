import { and, eq, lt, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "./db/client";
import { auditEvents, idempotencyKeys } from "./db/schema";
import { ApiError } from "./errors";
import { newId, sha256Hex } from "./ids";
import type { Ctx } from "./context";

/** A drizzle handle usable for queries: the root db or a transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Q = Db | Tx;

export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ApiError(
      "invalid_request",
      "request validation failed",
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

// ------------------------------------------------------------------ pagination

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

/** Returns a keyset-pagination predicate for ORDER BY created_at DESC, id DESC. */
export function cursorWhere(cursor: string | undefined, createdAtCol: AnyPgColumn, idCol: AnyPgColumn): SQL | undefined {
  if (!cursor) return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ApiError("invalid_request", "malformed cursor");
  }
  const [ts, id] = decoded.split("|");
  const when = ts ? new Date(ts) : null;
  if (!when || Number.isNaN(when.getTime()) || !id) throw new ApiError("invalid_request", "malformed cursor");
  return or(lt(createdAtCol, when), and(eq(createdAtCol, when), lt(idCol, id)));
}

/** Rows were fetched with `limit + 1`; trims and computes the next cursor. */
export function toPage<T extends { id: string; createdAt: Date }>(rows: T[], limit: number): Page<T> {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, nextCursor: more && last ? encodeCursor(last.createdAt, last.id) : null };
}

// ----------------------------------------------------------------------- audit

export async function audit(
  q: Q,
  ctx: Ctx,
  action: string,
  target?: { type: string; id: string },
  metadata?: Record<string, unknown>,
): Promise<void> {
  await q.insert(auditEvents).values({
    id: newId("aud"),
    workspaceId: ctx.principal.workspaceId,
    actorType: ctx.principal.kind,
    actorId: ctx.principal.id,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    metadata: metadata ?? null,
    createdAt: ctx.deps.now(),
  });
}

// ----------------------------------------------------------------- idempotency

export interface Handled {
  status: number;
  body: unknown;
  replayed?: boolean;
}

/**
 * Runs `fn` exactly once per (workspace, Idempotency-Key, operation).
 *  - same key + same body  -> the stored response is replayed (no second effect);
 *  - same key + different body, or key reused on another operation -> 422.
 * The key is claimed INSIDE the same transaction as the work, so a crash cannot
 * leave a half-applied effect, and concurrent duplicates wait on the unique
 * constraint then replay.
 * Without a key the work simply runs in its own transaction.
 */
export async function runIdempotent(
  ctx: Ctx,
  key: string | undefined,
  operation: string,
  body: unknown,
  fn: (tx: Tx) => Promise<Handled>,
): Promise<Handled> {
  const { db } = ctx.deps;
  if (!key) return db.transaction((tx) => fn(tx));
  if (key.length > 200 || key.length < 8) throw new ApiError("invalid_request", "Idempotency-Key must be 8–200 characters");

  const requestHash = sha256Hex(JSON.stringify(body ?? null));
  const workspaceId = ctx.principal.workspaceId;
  const where = and(eq(idempotencyKeys.workspaceId, workspaceId), eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation));

  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ workspaceId, key, operation, requestHash, responseStatus: 0, responseBody: {}, createdAt: ctx.deps.now() })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      const [prev] = await tx.select().from(idempotencyKeys).where(where);
      if (!prev || prev.responseStatus === 0) throw new ApiError("conflict", "a request with this Idempotency-Key is still in progress");
      if (prev.requestHash !== requestHash) {
        throw new ApiError("idempotency_conflict", "this Idempotency-Key was already used with a different request");
      }
      return { status: prev.responseStatus, body: prev.responseBody, replayed: true };
    }

    const result = await fn(tx);
    await tx.update(idempotencyKeys).set({ responseStatus: result.status, responseBody: result.body as object }).where(where);
    return result;
  });
}
