import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ResendMailer, hashPassword, schema, upsertOAuthUser, verifyCredentials, verifyPassword, type Mail } from "../src";
import { client, createTestApp, ORIGIN, type Call, type TestApp } from "./harness";

let app: TestApp;
let call: Call;

beforeAll(async () => {
  app = await createTestApp();
  call = client(app);
}, 60_000);
afterAll(() => app.close());

const PW = "Correct-Horse-9";
const tokenFrom = (link: string) => new URL(link).searchParams.get("token")!;
const signup = (email: string, password = PW, ip = "198.51.100." + Math.floor(Math.random() * 200)) =>
  call("POST", "/auth/signup", { body: { email, password }, ip });

describe("password hashing", () => {
  it("uses salted scrypt, verifies correctly, and rejects wrong/malformed input", async () => {
    const a = await hashPassword("Secret-Passw0rd", 1024);
    const b = await hashPassword("Secret-Passw0rd", 1024);
    expect(a).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(a).not.toBe(b); // unique salt per hash
    expect(a).not.toContain("Secret-Passw0rd");
    expect(await verifyPassword("Secret-Passw0rd", a)).toBe(true);
    expect(await verifyPassword("secret-passw0rd", a)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$8$1$AA$AA")).toBe(false); // refuses absurdly weak parameters
  });
});

describe("sign up", () => {
  it("creates an UNVERIFIED account with a hashed password and sends a verification link", async () => {
    const r = await signup("new@example.com");
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ ok: true });
    const [u] = await app.deps.db.select().from(schema.users).where(eq(schema.users.email, "new@example.com"));
    expect(u!.emailVerifiedAt).toBeNull();
    expect(u!.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(u)).not.toContain(PW);

    const link = app.mailer.lastLink("new@example.com")!;
    expect(link.startsWith(`${ORIGIN}/verify-email?token=`)).toBe(true);
    // Only the token's hash is stored.
    const rows = await app.deps.db.select().from(schema.authTokens).where(eq(schema.authTokens.userId, u!.id));
    expect(rows[0]!.tokenHash).not.toContain(tokenFrom(link));
  });

  it("does NOT reveal whether an email is already registered", async () => {
    await signup("exists@example.com");
    const before = app.mailer.outbox.length;
    const dup = await signup("exists@example.com", "Another-Pass-1");
    const fresh = await signup("brandnew@example.com");
    expect(dup.status).toBe(fresh.status);
    expect(dup.json).toEqual(fresh.json);
    expect(app.mailer.outbox.length).toBe(before + 1); // only the new account got mail
    // and the existing account's password was NOT overwritten
    expect(await verifyCredentials(app.deps, "exists@example.com", PW)).not.toBeNull();
    expect(await verifyCredentials(app.deps, "exists@example.com", "Another-Pass-1")).toBeNull();
  });

  it("enforces the password policy and email format", async () => {
    for (const bad of ["short1A", "alllowercase1", "NoDigitsHere", "x".repeat(129) + "A1"]) {
      expect((await signup(`p${Math.random()}@example.com`, bad)).status, bad).toBe(400);
    }
    expect((await call("POST", "/auth/signup", { body: { email: "not-an-email", password: PW }, ip: "198.51.100.250" })).status).toBe(400);
  });

  it("still succeeds if the mail provider is down (and never leaks that fact)", async () => {
    app.mailer.failWith = new Error("provider down");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await signup("mailfail@example.com");
    expect(r.status).toBe(202);
    spy.mockRestore();
    app.mailer.failWith = null;
  });

  it("is rate limited per IP", async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await call("POST", "/auth/signup", { body: { email: `rl${i}@example.com`, password: PW }, ip: "203.0.113.77" });
    expect(last!.status).toBe(429);
  });
});

describe("email verification", () => {
  it("verifies once; the link is single-use and expires", async () => {
    await signup("verify@example.com");
    const token = tokenFrom(app.mailer.lastLink("verify@example.com")!);
    const ok = await call("POST", "/auth/verify-email", { body: { token }, ip: "198.51.100.1" });
    expect(ok.status).toBe(200);
    const [u] = await app.deps.db.select().from(schema.users).where(eq(schema.users.email, "verify@example.com"));
    expect(u!.emailVerifiedAt).not.toBeNull();
    expect((await call("POST", "/auth/verify-email", { body: { token }, ip: "198.51.100.1" })).status).toBe(400); // reuse

    await signup("expire@example.com");
    const t2 = tokenFrom(app.mailer.lastLink("expire@example.com")!);
    app.clock.advance(25 * 3600_000);
    expect((await call("POST", "/auth/verify-email", { body: { token: t2 }, ip: "198.51.100.2" })).status).toBe(400);
  });

  it("rejects garbage tokens", async () => {
    expect((await call("POST", "/auth/verify-email", { body: { token: "x".repeat(43) }, ip: "198.51.100.3" })).status).toBe(400);
  });

  it("resend: invalidates the older link, is generic for unknown emails, and is throttled", async () => {
    await signup("resend@example.com");
    const first = tokenFrom(app.mailer.lastLink("resend@example.com")!);
    const r = await call("POST", "/auth/resend-verification", { body: { email: "resend@example.com" }, ip: "198.51.100.4" });
    expect(r.status).toBe(202);
    const second = tokenFrom(app.mailer.lastLink("resend@example.com")!);
    expect(second).not.toBe(first);
    expect((await call("POST", "/auth/verify-email", { body: { token: first }, ip: "198.51.100.4" })).status).toBe(400); // superseded
    expect((await call("POST", "/auth/verify-email", { body: { token: second }, ip: "198.51.100.4" })).status).toBe(200);

    const unknown = await call("POST", "/auth/resend-verification", { body: { email: "ghost@example.com" }, ip: "198.51.100.5" });
    expect(unknown.status).toBe(202);
    expect(unknown.json).toEqual(r.json);
    expect(app.mailer.outbox.some((m) => m.to === "ghost@example.com")).toBe(false);
  });
});

describe("credentials (used by Auth.js)", () => {
  it("accepts the right password and rejects wrong passwords and unknown users identically", async () => {
    await signup("login@example.com");
    const ok = await verifyCredentials(app.deps, "LOGIN@example.com", PW); // case-insensitive email
    expect(ok).toMatchObject({ email: "login@example.com", emailVerified: false });
    expect(await verifyCredentials(app.deps, "login@example.com", "Wrong-Pass-1")).toBeNull();
    expect(await verifyCredentials(app.deps, "nobody@example.com", PW)).toBeNull();
  });

  it("rate limits repeated failures per email", async () => {
    await signup("brute@example.com");
    for (let i = 0; i < 10; i++) await verifyCredentials(app.deps, "brute@example.com", "Wrong-Pass-1");
    await expect(verifyCredentials(app.deps, "brute@example.com", PW)).rejects.toMatchObject({ code: "rate_limited" });
    app.clock.advance(16 * 60_000);
    expect(await verifyCredentials(app.deps, "brute@example.com", PW)).not.toBeNull();
  });

  it("OAuth-only accounts (no password) cannot be logged into with a password", async () => {
    await upsertOAuthUser(app.deps, { email: "google-only@example.com", name: "G", emailVerified: true });
    expect(await verifyCredentials(app.deps, "google-only@example.com", PW)).toBeNull();
  });
});

describe("unverified accounts", () => {
  it("cannot use workspace APIs or create a workspace until verified; /me still works", async () => {
    await signup("unv@example.com");
    const [u] = await app.deps.db.select().from(schema.users).where(eq(schema.users.email, "unv@example.com"));
    const me = await call("GET", "/me", { user: u!.id });
    expect(me.json.user).toMatchObject({ email: "unv@example.com", emailVerified: false });
    expect((await call("GET", "/agents", { user: u!.id })).json.error.code).toBe("email_not_verified");
    const ws = await call("POST", "/workspaces", { user: u!.id, body: { name: "W", slug: "unv-ws" } });
    expect(ws.status).toBe(403);
    expect(ws.json.error.code).toBe("email_not_verified");

    await call("POST", "/auth/verify-email", { body: { token: tokenFrom(app.mailer.lastLink("unv@example.com")!) }, ip: "198.51.100.6" });
    expect((await call("POST", "/workspaces", { user: u!.id, body: { name: "W", slug: "unv-ws" } })).status).toBe(201);
    expect((await call("GET", "/agents", { user: u!.id })).status).toBe(200);
  });
});

describe("password reset", () => {
  it("is generic for unknown emails and sends no mail to them", async () => {
    const known = await call("POST", "/auth/forgot-password", { body: { email: "login@example.com" }, ip: "198.51.100.10" });
    const unknown = await call("POST", "/auth/forgot-password", { body: { email: "nobody-at-all@example.com" }, ip: "198.51.100.10" });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.json).toEqual(unknown.json);
    expect(app.mailer.outbox.some((m) => m.to === "nobody-at-all@example.com")).toBe(false);
  });

  it("resets the password with a single-use, 30-minute link and revokes ALL existing sessions", async () => {
    await signup("reset@example.com");
    await call("POST", "/auth/verify-email", { body: { token: tokenFrom(app.mailer.lastLink("reset@example.com")!) }, ip: "198.51.100.11" });
    const [u] = await app.deps.db.select().from(schema.users).where(eq(schema.users.email, "reset@example.com"));
    await call("POST", "/workspaces", { user: u!.id, body: { name: "R", slug: "reset-ws" } });

    // A session issued BEFORE the reset carries the old version (Auth.js stores it in the JWT).
    const oldSession = { ...app.deps, sessions: async () => ({ userId: u!.id, sessionVersion: u!.sessionVersion }) };
    const { createApi } = await import("../src");
    const oldApi = client({ ...app, handle: createApi(oldSession) } as TestApp);
    expect((await oldApi("GET", "/agents", { user: u!.id })).status).toBe(200);

    await call("POST", "/auth/forgot-password", { body: { email: "reset@example.com" }, ip: "198.51.100.12" });
    const link = app.mailer.lastLink("reset@example.com")!;
    expect(link).toContain("/reset-password?token=");
    const token = tokenFrom(link);

    const weak = await call("POST", "/auth/reset-password", { body: { token, password: "weak" }, ip: "198.51.100.12" });
    expect(weak.status).toBe(400); // policy enforced; token NOT burned by a rejected password
    const NEW = "Brand-New-Pass-7";
    expect((await call("POST", "/auth/reset-password", { body: { token, password: NEW }, ip: "198.51.100.12" })).status).toBe(200);

    expect(await verifyCredentials(app.deps, "reset@example.com", NEW)).not.toBeNull();
    expect(await verifyCredentials(app.deps, "reset@example.com", PW)).toBeNull();
    expect((await call("POST", "/auth/reset-password", { body: { token, password: "Another-Pass-8" }, ip: "198.51.100.12" })).status).toBe(400); // single use

    const revoked = await oldApi("GET", "/agents", { user: u!.id });
    expect(revoked.status).toBe(401);
    expect(revoked.json.error.message).toMatch(/revoked/);
  });

  it("the link expires after 30 minutes", async () => {
    await signup("slow@example.com");
    await call("POST", "/auth/forgot-password", { body: { email: "slow@example.com" }, ip: "198.51.100.13" });
    const token = tokenFrom(app.mailer.lastLink("slow@example.com")!);
    app.clock.advance(31 * 60_000);
    expect((await call("POST", "/auth/reset-password", { body: { token, password: "Brand-New-Pass-7" }, ip: "198.51.100.13" })).status).toBe(400);
  });

  it("a newer reset link supersedes the older one", async () => {
    await signup("twice@example.com");
    await call("POST", "/auth/forgot-password", { body: { email: "twice@example.com" }, ip: "198.51.100.14" });
    const a = tokenFrom(app.mailer.lastLink("twice@example.com")!);
    app.clock.advance(1000);
    // per-email mail throttle is 3/hour, so a second request still sends
    await call("POST", "/auth/forgot-password", { body: { email: "twice@example.com" }, ip: "198.51.100.14" });
    const b = tokenFrom(app.mailer.lastLink("twice@example.com")!);
    expect(a).not.toBe(b);
    expect((await call("POST", "/auth/reset-password", { body: { token: a, password: "Brand-New-Pass-7" }, ip: "198.51.100.14" })).status).toBe(400);
    expect((await call("POST", "/auth/reset-password", { body: { token: b, password: "Brand-New-Pass-7" }, ip: "198.51.100.14" })).status).toBe(200);
  });

  it("limits reset emails per address (mail-bombing protection) without changing the response", async () => {
    await signup("bombed@example.com");
    const before = app.mailer.outbox.length;
    for (let i = 0; i < 6; i++) {
      const r = await call("POST", "/auth/forgot-password", { body: { email: "bombed@example.com" }, ip: `198.51.101.${i}` });
      expect(r.status).toBe(202);
    }
    expect(app.mailer.outbox.length - before).toBeLessThanOrEqual(3);
  });
});

describe("OAuth (Google) accounts", () => {
  it("only trusts the provider's verified-email claim and never lets an unverified claim take over an account", async () => {
    expect(await upsertOAuthUser(app.deps, { email: "oauth-new@example.com", emailVerified: false })).toBeNull();
    const made = await upsertOAuthUser(app.deps, { email: "oauth-new@example.com", name: "O", emailVerified: true });
    expect(made).toMatchObject({ email: "oauth-new@example.com" });
    const [u] = await app.deps.db.select().from(schema.users).where(eq(schema.users.email, "oauth-new@example.com"));
    expect(u!.emailVerifiedAt).not.toBeNull();
    expect(u!.passwordHash).toBeNull();

    // An existing, unverified password account: an UNVERIFIED claim must not verify/hijack it…
    await signup("pre-registered@example.com");
    expect(await upsertOAuthUser(app.deps, { email: "pre-registered@example.com", emailVerified: false })).toBeNull();
    const [pre] = await app.deps.db.select().from(schema.users).where(eq(schema.users.email, "pre-registered@example.com"));
    expect(pre!.emailVerifiedAt).toBeNull();
  });
});

describe("ResendMailer", () => {
  const mail: Mail = { to: "a@example.com", subject: "S", text: "https://x.example/verify?token=abc" };

  it("POSTs to Resend with a bearer key and the right payload", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await new ResendMailer({ apiKey: "re_test_key", from: "Verid <no-reply@verid.dev>", fetch: f as unknown as typeof fetch }).send(mail);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body as string)).toMatchObject({ from: "Verid <no-reply@verid.dev>", to: ["a@example.com"], subject: "S" });
  });

  it("throws a sanitized error on failure (no recipient, token or key in the message)", async () => {
    const f = vi.fn(async () => new Response("denied a@example.com re_test_key", { status: 403 }));
    const err = await new ResendMailer({ apiKey: "re_test_key", from: "x@verid.dev", fetch: f as unknown as typeof fetch })
      .send(mail)
      .then(() => null, (e: Error) => e);
    expect(err?.message).toBe("Resend rejected the email (HTTP 403)");
  });

  it("retries a network blip and a 5xx, but never a 4xx (retrying a bad key or sender cannot help)", async () => {
    let n = 0;
    const flaky = vi.fn(async () => {
      n++;
      if (n === 1) throw new TypeError("fetch failed");
      if (n === 2) return new Response("{}", { status: 503 });
      return new Response("{}", { status: 200 });
    });
    await new ResendMailer({ apiKey: "k", from: "x@verid.dev", fetch: flaky as unknown as typeof fetch, retryDelayMs: 1 }).send(mail);
    expect(flaky).toHaveBeenCalledTimes(3);

    const denied = vi.fn(async () => new Response("{}", { status: 422 }));
    await expect(new ResendMailer({ apiKey: "k", from: "x@verid.dev", fetch: denied as unknown as typeof fetch, retryDelayMs: 1 }).send(mail)).rejects.toThrow("HTTP 422");
    expect(denied).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(new ResendMailer({ apiKey: "k", from: "x@verid.dev", fetch: down as unknown as typeof fetch, retryDelayMs: 1 }).send(mail)).rejects.toThrow("could not reach Resend");
    expect(down).toHaveBeenCalledTimes(3);
  });

  it("refuses to construct without credentials", () => {
    expect(() => new ResendMailer({ apiKey: "", from: "x" })).toThrow();
    expect(() => new ResendMailer({ apiKey: "k", from: "" })).toThrow();
  });
});

describe("dev outbox", () => {
  it("is inert (404) unless explicitly injected", async () => {
    expect((await call("GET", "/dev/outbox", { ip: "198.51.100.30" })).status).toBe(404);
    const dev = await createTestApp({ devOutbox: () => [{ subject: "hi" }] });
    expect((await client(dev)("GET", "/dev/outbox")).json.data).toEqual([{ subject: "hi" }]);
    await dev.close();
  });
});
