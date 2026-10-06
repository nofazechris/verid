import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Deps } from "../context";
import { authTokens, auditEvents, users } from "../db/schema";
import { ApiError } from "../errors";
import { newId, sha256Hex } from "../ids";
import { resetPasswordMail, verifyEmailMail } from "../mailer";
import { DEFAULT_SCRYPT_N, hashPassword, passwordSchema, verifyPassword } from "../password";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

const email = z.string().trim().toLowerCase().email().max(254);

export const signUpInput = z.object({ email, password: passwordSchema, name: z.string().trim().max(100).optional() });
export const forgotInput = z.object({ email });
export const resetInput = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const tokenInput = z.object({ token: z.string().min(20).max(200) });

/** Identical for every outcome so responses cannot be used to discover which emails have accounts. */
const GENERIC = { ok: true } as const;

function parseIn<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new ApiError("invalid_request", "request validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}

let dummyHash: Promise<string> | undefined;
/** A throwaway hash so logging in as an unknown user costs the same as a real attempt. */
const getDummy = (n: number) => (dummyHash ??= hashPassword("not-a-real-password-Aa1", n));

async function issueToken(deps: Deps, userId: string, purpose: "verify_email" | "reset_password", ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    // Only the newest link works: invalidate older unused tokens of the same purpose.
    await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
    await tx.insert(authTokens).values({
      id: newId("tok"), userId, purpose, tokenHash: sha256Hex(raw), expiresAt: new Date(now.getTime() + ttlMs), createdAt: now,
    });
  });
  return raw;
}

/** Atomically burn a token. Returns the user id, or null if unknown / expired / already used. */
async function consumeToken(deps: Deps, raw: string, purpose: "verify_email" | "reset_password"): Promise<string | null> {
  const now = deps.now();
  const rows = await deps.db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.tokenHash, sha256Hex(raw)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
    .returning({ userId: authTokens.userId });
  return rows[0]?.userId ?? null;
}

async function safeSend(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (e) {
    // A mail failure must not change the response (that would reveal whether the account exists).
    console.error("[verid] email delivery failed:", e instanceof Error ? e.message : "unknown error");
  }
}

const link = (deps: Deps, path: string, token: string) => `${deps.appUrl.replace(/\/+$/, "")}${path}?token=${encodeURIComponent(token)}`;

/** Per-email throttle for mail-sending actions; silently skips sending when exceeded. */
const mailAllowed = (deps: Deps, kind: string, addr: string) => deps.limiter.consume(`mail:${kind}:${addr}`, 3, 60 * 60_000).ok;

// ----------------------------------------------------------------------------- sign up

export async function signUp(deps: Deps, raw: unknown) {
  const input = parseIn(signUpInput, raw);
  const n = deps.scryptN ?? DEFAULT_SCRYPT_N;
  // Hash first, on every path, so timing doesn't reveal whether the email was already registered.
  const passwordHash = await hashPassword(input.password, n);
  const now = deps.now();

  const inserted = await deps.db
    .insert(users)
    .values({ id: newId("usr"), email: input.email, name: input.name ?? null, passwordHash, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: users.id });

  const created = inserted[0];
  if (created && mailAllowed(deps, "verify", input.email)) {
    const token = await issueToken(deps, created.id, "verify_email", VERIFY_TTL_MS);
    await safeSend(() => deps.mailer.send(verifyEmailMail(input.email, link(deps, "/verify-email", token))));
  }
  // Existing account: do nothing observable (no error, no password overwrite, no mail).
  return GENERIC;
}

// ------------------------------------------------------------------------- credentials

/**
 * Check an email + password. Used by the Auth.js Credentials provider (server-side only —
 * there is deliberately no HTTP endpoint for it, so login has a single surface).
 * Returns the user, or null for ANY failure. Rate limited per email.
 */
export async function verifyCredentials(deps: Deps, rawEmail: string, password: string) {
  const addr = rawEmail.trim().toLowerCase();
  if (!deps.limiter.consume(`login:${addr}`, 10, 15 * 60_000).ok) {
    throw new ApiError("rate_limited", "too many sign-in attempts; try again later");
  }
  const n = deps.scryptN ?? DEFAULT_SCRYPT_N;
  const [user] = await deps.db.select().from(users).where(eq(users.email, addr));
  const stored = user?.passwordHash ?? (await getDummy(n));
  const ok = await verifyPassword(password, stored);
  if (!user || !user.passwordHash || !ok) return null;
  return { id: user.id, email: user.email, name: user.name, emailVerified: !!user.emailVerifiedAt, sessionVersion: user.sessionVersion };
}

// ------------------------------------------------------------------------ verification

export async function verifyEmail(deps: Deps, raw: unknown) {
  const { token } = parseIn(tokenInput, raw);
  const userId = await consumeToken(deps, token, "verify_email");
  if (!userId) throw new ApiError("invalid_request", "this verification link is invalid or has expired");
  const now = deps.now();
  await deps.db.update(users).set({ emailVerifiedAt: now, updatedAt: now }).where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  return { ok: true as const, verified: true as const };
}

export async function resendVerification(deps: Deps, raw: unknown) {
  const { email: addr } = parseIn(forgotInput, raw);
  const [user] = await deps.db.select().from(users).where(eq(users.email, addr));
  if (user && !user.emailVerifiedAt && mailAllowed(deps, "verify", addr)) {
    const token = await issueToken(deps, user.id, "verify_email", VERIFY_TTL_MS);
    await safeSend(() => deps.mailer.send(verifyEmailMail(addr, link(deps, "/verify-email", token))));
  }
  return GENERIC;
}

// ---------------------------------------------------------------------- password reset

export async function forgotPassword(deps: Deps, raw: unknown) {
  const { email: addr } = parseIn(forgotInput, raw);
  const [user] = await deps.db.select().from(users).where(eq(users.email, addr));
  if (user && mailAllowed(deps, "reset", addr)) {
    const token = await issueToken(deps, user.id, "reset_password", RESET_TTL_MS);
    await safeSend(() => deps.mailer.send(resetPasswordMail(addr, link(deps, "/reset-password", token))));
  }
  return GENERIC;
}

/**
 * Complete a reset. The token is single-use and expires in 30 minutes. On success every
 * existing session is revoked (sessionVersion++), and the email counts as verified because
 * the user just proved control of the inbox.
 */
export async function resetPassword(deps: Deps, raw: unknown) {
  const input = parseIn(resetInput, raw);
  const passwordHash = await hashPassword(input.password, deps.scryptN ?? DEFAULT_SCRYPT_N);
  const userId = await consumeToken(deps, input.token, "reset_password");
  if (!userId) throw new ApiError("invalid_request", "this reset link is invalid or has expired");
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    await tx
      .update(users)
      .set({ passwordHash, sessionVersion: (u?.sessionVersion ?? 0) + 1, emailVerifiedAt: u?.emailVerifiedAt ?? now, updatedAt: now })
      .where(eq(users.id, userId));
    await tx.update(authTokens).set({ usedAt: now }).where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt)));
    await tx.insert(auditEvents).values({ id: newId("aud"), workspaceId: null, actorType: "user", actorId: userId, action: "auth.password_reset", createdAt: now });
  });
  return { ok: true as const };
}

/** Look up (or create) a user for an OAuth sign-in (e.g. Google). Only trusts the provider's verified-email claim. */
export async function upsertOAuthUser(deps: Deps, input: { email: string; name?: string | null; emailVerified: boolean }) {
  const addr = email.parse(input.email);
  const now = deps.now();
  const [existing] = await deps.db.select().from(users).where(eq(users.email, addr));
  if (existing) {
    // Never let an unverified provider claim take over, or verify, an account.
    if (!input.emailVerified) return null;
    if (!existing.emailVerifiedAt) await deps.db.update(users).set({ emailVerifiedAt: now, updatedAt: now }).where(eq(users.id, existing.id));
    return { id: existing.id, email: existing.email, name: existing.name, sessionVersion: existing.sessionVersion };
  }
  if (!input.emailVerified) return null;
  const [row] = await deps.db
    .insert(users)
    .values({ id: newId("usr"), email: addr, name: input.name ?? null, emailVerifiedAt: now, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning();
  const user = row ?? (await deps.db.select().from(users).where(eq(users.email, addr)))[0]!;
  return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion };
}
