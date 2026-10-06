import { eq } from "drizzle-orm";
import type { Deps, Principal, UserPrincipal } from "./context";
import { users } from "./db/schema";
import { ApiError } from "./errors";
import { authenticateApiKey, resolveMembership } from "./services/workspaces";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const challenge = { "www-authenticate": 'Bearer realm="verid"' };

/**
 * Resolve the signed-in USER from a cookie session (no workspace yet).
 *  - CSRF: unsafe methods must carry an Origin from the allowlist;
 *  - revocation: the session's version must equal the user's current one, so a
 *    password reset instantly invalidates every older session.
 */
export async function authenticateUser(req: Request, deps: Deps): Promise<UserPrincipal> {
  const session = deps.sessions ? await deps.sessions(req) : null;
  if (!session) throw new ApiError("unauthenticated", "authentication required", undefined, challenge);

  if (UNSAFE.has(req.method)) {
    const origin = req.headers.get("origin");
    if (!origin || !deps.allowedOrigins.includes(origin)) throw new ApiError("forbidden", "cross-origin request rejected");
  }

  const [user] = await deps.db.select().from(users).where(eq(users.id, session.userId));
  if (!user) throw new ApiError("unauthenticated", "session is no longer valid", undefined, challenge);
  if (session.sessionVersion !== undefined && session.sessionVersion !== user.sessionVersion) {
    throw new ApiError("unauthenticated", "session has been revoked; sign in again", undefined, challenge);
  }
  return { userId: user.id, email: user.email, emailVerified: !!user.emailVerifiedAt };
}

/**
 * Resolve who is calling a WORKSPACE API. Two mechanisms:
 *  - `Authorization: Bearer verid_...` API key: bound to ONE workspace, never admin;
 *  - cookie session: the workspace comes from the `X-Verid-Workspace` header but is
 *    honoured ONLY if the user is a member (and, by default, has verified their email).
 *
 * A request presenting a bearer token that fails is rejected outright; it never
 * silently falls back to a cookie session.
 */
export async function authenticate(req: Request, deps: Deps): Promise<Principal> {
  const header = req.headers.get("authorization");
  if (header) {
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const principal = m ? await authenticateApiKey(deps.db, m[1]!, deps.now()) : null;
    if (!principal) throw new ApiError("unauthenticated", "invalid or expired API key", undefined, challenge);
    return principal;
  }

  const user = await authenticateUser(req, deps);
  if ((deps.requireVerifiedEmail ?? true) && !user.emailVerified) {
    throw new ApiError("email_not_verified", "verify your email address to continue");
  }
  return resolveMembership(deps.db, user.userId, req.headers.get("x-verid-workspace") ?? undefined);
}

/** Best-effort client IP. Only meaningful behind a proxy that sets/overwrites X-Forwarded-For. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
