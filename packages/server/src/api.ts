import { createValidator, createValidatorVersion, ensureValidator, listCustomValidators, testValidator } from "./services/validators";
import { getSettlement, listSettlements, registerSettlement, settle } from "./services/settlements";
import { randomUUID } from "node:crypto";
import { authenticate, authenticateUser, clientIp } from "./auth";
import type { Ctx, Deps, UserPrincipal } from "./context";
import { ApiError } from "./errors";
import { addEvidence, completeExecution, createExecution, failExecution, getExecution, listEvidence, listExecutions, startExecution } from "./services/executions";
import { createAgent, deleteAgent, createPolicy, createPolicyVersion, getAgent, getPolicy, listAgents, listPolicies, updateAgent } from "./services/catalog";
import { activity, listValidators, networkStatus, onboarding, overview, validatorHistory } from "./services/overview";
import {
  anchorReceipt, createReceipt, getPublicReceipt, getReceipt, getValidation, listReceipts, runValidation, verifySupplied,
} from "./services/receipts";
import { forgotPassword, resendVerification, resetPassword, signUp, verifyEmail } from "./services/auth";
import {
  createApiKey, createWorkspace, getWorkspace, listApiKeys, listMembers, listWorkspacesForUser, revokeApiKey,
} from "./services/workspaces";
import type { Handled } from "./util";

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const AUTHED_LIMIT = { limit: 600, windowMs: 60_000 };
const PUBLIC_LIMIT = { limit: 30, windowMs: 60_000 };
/** Credential/mail endpoints are far stricter: they are brute-force and abuse targets. */
const AUTH_LIMIT = { limit: 10, windowMs: 60_000 };

interface RouteArgs {
  req: Request;
  deps: Deps;
  params: Record<string, string>;
  query: Record<string, string>;
  idemKey: string | undefined;
  body: () => Promise<unknown>;
}
type AuthedHandler = (a: RouteArgs & { ctx: Ctx }) => Promise<Handled>;
type PublicHandler = (a: RouteArgs) => Promise<Handled>;
type UserHandler = (a: RouteArgs & { user: UserPrincipal }) => Promise<Handled>;

type Kind = "authed" | "public" | "auth" | "user";
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  kind: Kind;
  handler: AuthedHandler | PublicHandler | UserHandler;
}

const routes: Route[] = [];
function add(method: string, path: string, handler: AuthedHandler): void;
function add(method: string, path: string, handler: PublicHandler, kind: "public" | "auth"): void;
function add(method: string, path: string, handler: UserHandler, kind: "user"): void;
function add(method: string, path: string, handler: AuthedHandler | PublicHandler | UserHandler, kind: Kind = "authed"): void {
  const keys: string[] = [];
  const src = path.replace(/:([a-zA-Z]+)/g, (_m, k: string) => {
    keys.push(k);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${src}$`), keys, kind, handler });
}
const ok = (body: unknown, status = 200): Handled => ({ status, body });

// ---- workspace & settings
add("GET", "/workspace", async ({ ctx }) => ok(await getWorkspace(ctx)));
add("GET", "/workspace/members", async ({ ctx }) => ok({ data: await listMembers(ctx) }));
add("GET", "/overview", async ({ ctx }) => ok(await overview(ctx)));
add("GET", "/onboarding", async ({ ctx }) => ok(await onboarding(ctx)));
add("GET", "/activity", async ({ ctx, query }) => ok(await activity(ctx, query)));
add("POST", "/api-keys", async ({ ctx, body }) => ok(await createApiKey(ctx, await body()), 201));
add("GET", "/api-keys", async ({ ctx }) => ok({ data: await listApiKeys(ctx) }));
add("DELETE", "/api-keys/:id", async ({ ctx, params }) => ok(await revokeApiKey(ctx, params.id!)));

// ---- agents & policies
add("POST", "/agents", async ({ ctx, body }) => ok({ agent: await createAgent(ctx, await body()) }, 201));
add("GET", "/agents", async ({ ctx, query }) => ok(await listAgents(ctx, query)));
add("GET", "/agents/:id", async ({ ctx, params }) => ok({ agent: await getAgent(ctx, params.id!) }));
add("DELETE", "/agents/:id", async ({ ctx, params }) => ok(await deleteAgent(ctx, params.id!)));
add("PATCH", "/agents/:id", async ({ ctx, params, body }) => ok({ agent: await updateAgent(ctx, params.id!, await body()) }));
add("POST", "/policies", async ({ ctx, body }) => ok({ policy: await createPolicy(ctx, await body()) }, 201));
add("GET", "/policies", async ({ ctx, query }) => ok(await listPolicies(ctx, query)));
add("GET", "/policies/:id", async ({ ctx, params }) => ok({ policy: await getPolicy(ctx, params.id!) }));
add("PATCH", "/policies/:id", async ({ ctx, params, body }) => ok({ policy: await createPolicyVersion(ctx, params.id!, await body()) }, 201));

// ---- executions
add("POST", "/executions", async ({ ctx, idemKey, body }) => createExecution(ctx, idemKey, await body()));
add("GET", "/executions", async ({ ctx, query }) => ok(await listExecutions(ctx, query)));
add("GET", "/executions/:id", async ({ ctx, params }) => ok({ execution: await getExecution(ctx, params.id!) }));
add("POST", "/executions/:id/start", async ({ ctx, params }) => startExecution(ctx, params.id!));
add("GET", "/executions/:id/evidence", async ({ ctx, params, query }) => ok(await listEvidence(ctx, params.id!, query)));
add("POST", "/executions/:id/evidence", async ({ ctx, params, idemKey, body }) => addEvidence(ctx, params.id!, idemKey, await body()));
add("POST", "/executions/:id/fail", async ({ ctx, params, body }) => failExecution(ctx, params.id!, await body()));
add("POST", "/executions/:id/complete", async ({ ctx, params, idemKey, body }) => completeExecution(ctx, params.id!, idemKey, await body()));

// ---- validation, receipts, anchoring
add("POST", "/validations", async ({ ctx, idemKey, body }) => runValidation(ctx, idemKey, await body()));
add("GET", "/validations/:id", async ({ ctx, params }) => ok({ validation: await getValidation(ctx, params.id!) }));
add("GET", "/validators", async ({ ctx }) => {
  const all = [...listValidators(), ...(await listCustomValidators(ctx))];
  return ok({ data: await Promise.all(all.map(async (v) => ({ ...v, outcomes: await validatorHistory(ctx, v.id) }))) });
});
add("POST", "/validators", async ({ ctx, body }) => ok({ validator: await createValidator(ctx, await body()) }, 201));
add("POST", "/validators/ensure", async ({ ctx, body }) => ok(await ensureValidator(ctx, await body())));
add("POST", "/validators/test", async ({ ctx, body }) => ok(await testValidator(ctx, await body())));
add("PATCH", "/validators/:slug", async ({ ctx, params, body }) => ok({ validator: await createValidatorVersion(ctx, params.slug!, await body()) }, 201));
add("POST", "/receipts", async ({ ctx, body }) => createReceipt(ctx, await body()));
add("GET", "/receipts", async ({ ctx, query }) => ok(await listReceipts(ctx, query)));
add("GET", "/receipts/:id", async ({ ctx, params }) => ok(await getReceipt(ctx, params.id!)));
add("POST", "/receipts/:id/anchor", async ({ ctx, params }) => anchorReceipt(ctx, params.id!));

// ---- settlement (USDC escrow)
add("GET", "/settlements", async ({ ctx, query }) => ok(await listSettlements(ctx, query)));
add("GET", "/executions/:id/settlement", async ({ ctx, params }) => ok(await getSettlement(ctx, params.id!)));
add("POST", "/executions/:id/settlement", async ({ ctx, params }) => registerSettlement(ctx, params.id!));
add("POST", "/executions/:id/settle", async ({ ctx, params }) => settle(ctx, params.id!));

// ---- account (signed-in user; no workspace needed yet)
add("GET", "/me", async ({ user, deps }) => ok({ user, workspaces: await listWorkspacesForUser(deps.db, user.userId) }), "user");
add("GET", "/workspaces", async ({ user, deps }) => ok({ data: await listWorkspacesForUser(deps.db, user.userId) }), "user");
add(
  "POST",
  "/workspaces",
  async ({ user, deps, body }) => {
    if ((deps.requireVerifiedEmail ?? true) && !user.emailVerified) throw new ApiError("email_not_verified", "verify your email address to continue");
    return ok({ workspace: await createWorkspace(deps.db, deps.now(), user.userId, await body()) }, 201);
  },
  "user",
);

// ---- authentication (public, strictly rate-limited; identical responses for existing/unknown emails)
add("POST", "/auth/signup", async ({ deps, body }) => ok(await signUp(deps, await body()), 202), "auth");
add("POST", "/auth/verify-email", async ({ deps, body }) => ok(await verifyEmail(deps, await body())), "auth");
add("POST", "/auth/resend-verification", async ({ deps, body }) => ok(await resendVerification(deps, await body()), 202), "auth");
add("POST", "/auth/forgot-password", async ({ deps, body }) => ok(await forgotPassword(deps, await body()), 202), "auth");
add("POST", "/auth/reset-password", async ({ deps, body }) => ok(await resetPassword(deps, await body())), "auth");

// ---- public (no auth; strictly rate-limited per IP)
add("POST", "/receipts/verify", async ({ deps, body }) => ok(await verifySupplied(deps, await body())), "public");
add("GET", "/public/receipts/:id", async ({ deps, params }) => ok(await getPublicReceipt(deps, params.id!)), "public");
add("GET", "/network/status", async ({ deps }) => ok(await networkStatus(deps)), "public");
// Inert unless a dev outbox was injected (never in production).
add("GET", "/dev/outbox", async ({ deps }) => {
  if (!deps.devOutbox) throw new ApiError("not_found", "no such route");
  return ok({ data: deps.devOutbox() });
}, "public");

// ------------------------------------------------------------------------------

const SECURITY_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown, requestId: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, "x-request-id": requestId, ...extra } });
}

/**
 * Build the `/api/v1` request handler. Uses Web-standard Request/Response, so
 * it mounts directly in a Next.js route handler (and in tests, with no server).
 */
export function createApi(deps: Deps, opts: { basePath?: string } = {}) {
  const base = opts.basePath ?? "/api/v1";

  return async function handle(req: Request): Promise<Response> {
    const requestId = randomUUID();
    try {
      const url = new URL(req.url);
      if (!url.pathname.startsWith(base + "/") && url.pathname !== base) throw new ApiError("not_found", "no such route");
      const path = url.pathname.slice(base.length) || "/";

      let route: Route | undefined;
      let match: RegExpExecArray | null = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = r.pattern.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (r.method === req.method) {
          route = r;
          match = m;
          break;
        }
      }
      if (!route || !match) {
        if (pathMatched) throw new ApiError("invalid_request", "method not allowed");
        throw new ApiError("not_found", "no such route");
      }
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match![i + 1]!)]));
      const query = Object.fromEntries(url.searchParams);

      let parsedBody: { value: unknown } | undefined;
      const body = async () => {
        if (!parsedBody) {
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > MAX_BODY_BYTES) throw new ApiError("payload_too_large", "request body too large");
          const text = await req.text();
          if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new ApiError("payload_too_large", "request body too large");
          if (text === "") parsedBody = { value: {} };
          else {
            try {
              parsedBody = { value: JSON.parse(text) };
            } catch {
              throw new ApiError("invalid_request", "request body is not valid JSON");
            }
          }
        }
        return parsedBody.value;
      };
      const args: RouteArgs = { req, deps, params, query, idemKey: req.headers.get("idempotency-key") ?? undefined, body };

      let result: Handled;
      if (route.kind === "public" || route.kind === "auth") {
        const lim = route.kind === "auth" ? AUTH_LIMIT : PUBLIC_LIMIT;
        const rl = deps.limiter.consume(`${route.kind}:${clientIp(req)}`, lim.limit, lim.windowMs);
        if (!rl.ok) throw new ApiError("rate_limited", "too many requests", undefined, { "retry-after": String(rl.retryAfter) });
        result = await (route.handler as PublicHandler)(args);
      } else if (route.kind === "user") {
        const user = await authenticateUser(req, deps);
        const rl = deps.limiter.consume(`u:${user.userId}`, AUTHED_LIMIT.limit, AUTHED_LIMIT.windowMs);
        if (!rl.ok) throw new ApiError("rate_limited", "too many requests", undefined, { "retry-after": String(rl.retryAfter) });
        result = await (route.handler as UserHandler)({ ...args, user });
      } else {
        const principal = await authenticate(req, deps);
        const rl = deps.limiter.consume(`p:${principal.kind}:${principal.id}`, AUTHED_LIMIT.limit, AUTHED_LIMIT.windowMs);
        if (!rl.ok) throw new ApiError("rate_limited", "too many requests", undefined, { "retry-after": String(rl.retryAfter) });
        result = await (route.handler as AuthedHandler)({ ...args, ctx: { deps, principal } });
      }
      return json(result.status, result.body, requestId, result.replayed ? { "idempotent-replay": "true" } : {});
    } catch (e) {
      if (e instanceof ApiError) {
        return json(e.status, { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } }, requestId, e.headers);
      }
      // Never leak internals. The request id correlates with server logs.
      console.error(`[verid] unhandled error (request ${requestId}):`, e instanceof Error ? e.stack ?? e.message : "unknown");
      return json(500, { error: { code: "internal", message: "internal server error" } }, requestId);
    }
  };
}
