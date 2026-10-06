"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Spinner } from "@/components/kit";
import AuthShell, { AuthField, FormError, GoogleMark, ctaCss, safeNext, secondaryCss } from "@/components/auth/AuthShell";
import { useSession } from "@/lib/client/session";

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { status, refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "form" | "google">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    if (status === "authed" && !done) router.replace(next);
  }, [status, done, next, router]);

  useEffect(() => {
    fetch("/api/auth/providers").then((r) => r.json()).then((p) => setGoogle(!!p?.google)).catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy("form");
    const res = await signIn("credentials", { email, password, redirect: false });
    if (!res || res.error) {
      setBusy("");
      // One generic message for wrong password, unknown email and rate limiting alike.
      setError("Email or password is incorrect.");
      return;
    }
    setDone(true);
    await refresh();
    setTimeout(() => router.push(next), 700);
  };

  return (
    <AuthShell title="Welcome back." sub="Sign in to continue building verifiable autonomous systems." foot="VERID · EXECUTION EVIDENCE LAYER" successLabel={done ? "AUTHENTICATED" : undefined}>
      <form onSubmit={submit} style={s("display:flex;flex-direction:column;gap:18px")} noValidate>
        <AuthField id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" autoComplete="email" disabled={!!busy} />
        <AuthField
          id="password" label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••••••" autoComplete="current-password" disabled={!!busy}
          aside={<A href="/forgot-password" css="margin-left:auto;font-size:12.5px;color:#9BA39E;white-space:nowrap;flex:none">Forgot password?</A>}
        />
        {error && <FormError message={error} />}
        <Btn type="submit" disabled={!!busy} css={ctaCss(!!busy)} hover="background:#24805F;transform:translateY(-1px)">
          {busy === "form" && <Spinner />} {busy === "form" ? "Signing in…" : "Sign in"}
        </Btn>
      </form>

      {google && (
        <div style={s("display:flex;flex-direction:column;gap:18px")}>
          <div style={s("display:flex;align-items:center;gap:12px")}>
            <span style={s("flex:1;height:1px;background:#252B27")} />
            <span style={s("font-family:'Geist Mono',monospace;font-size:10.5px;letter-spacing:0.14em;color:#6B736E")}>OR</span>
            <span style={s("flex:1;height:1px;background:#252B27")} />
          </div>
          <Btn disabled={!!busy} onClick={() => { setBusy("google"); void signIn("google", { callbackUrl: next }); }} css={secondaryCss + ";height:46px;font-size:14px;gap:10px"} hover="background:#1A1F1C">
            <GoogleMark />{busy === "google" ? "Connecting…" : "Continue with Google"}
          </Btn>
        </div>
      )}

      <div style={s("padding-top:20px;border-top:1px solid #1D221F;font-size:13.5px;color:#9BA39E")}>
        Don’t have an account? <A href="/signup" css="color:#4ADE80;font-weight:500">Create one</A>
      </div>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
