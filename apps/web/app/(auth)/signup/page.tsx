"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Spinner } from "@/components/kit";
import AuthShell, { AuthField, FormError, PasswordRules, GoogleMark, ctaCss, passwordOk, secondaryCss } from "@/components/auth/AuthShell";
import { ApiClientError, post } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";

export default function Signup() {
  const router = useRouter();
  const { status, refresh } = useSession();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState<{ email?: string; pw2?: string }>({});
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [google, setGoogle] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/providers").then((r) => r.json()).then((p) => setGoogle(!!p?.google)).catch(() => {});
  }, []);

  useEffect(() => {
    if (status === "authed" && !done) router.replace("/overview");
  }, [status, done, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setFieldErr({});
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setFieldErr({ email: "Enter a valid email address." });
    if (!passwordOk(pw)) {
      setTouched(true);
      return setError("Password does not meet the requirements.");
    }
    if (pw !== pw2) return setFieldErr({ pw2: "Passwords do not match." });

    setBusy(true);
    try {
      await post("/auth/signup", { email: email.trim(), password: pw });
    } catch (err) {
      setBusy(false);
      return setError(err instanceof ApiClientError && err.status === 429 ? "Too many attempts. Please wait a minute and try again." : "We couldn't create the account. Check your details and try again.");
    }
    // Sign in immediately. If the email already had an account the password won't match, and we show the SAME
    // neutral message either way, so this screen never reveals whether an address is registered.
    const res = await signIn("credentials", { email: email.trim(), password: pw, redirect: false });
    if (res && !res.error) {
      setDone(true);
      await refresh();
      setTimeout(() => router.push("/verify-email"), 600);
    } else {
      setBusy(false);
      setSent(true);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your inbox." sub={<>If <b style={{ color: "#E8ECE9" }}>{email}</b> is new to Verid, we’ve sent a verification link. If you already have an account, sign in instead.</>} foot="LINK EXPIRES IN 24 HOURS">
        <A href="/login" css="height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #2C8A66;background:#1F6B4F;color:#E8ECE9;font-size:14px;font-weight:500">Go to sign in</A>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Start proving autonomous work." sub="Create your Verid workspace and generate your first execution proof." foot="NO CARD REQUIRED · FREE WHILE IN PREVIEW" successLabel={done ? "WORKSPACE READY" : undefined}>
      <form onSubmit={submit} style={s("display:flex;flex-direction:column;gap:18px")} noValidate>
        <AuthField id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" autoComplete="email" error={fieldErr.email} disabled={busy} />
        <AuthField id="pw" label="Password" type="password" value={pw} onChange={(v) => { setPw(v); setTouched(true); }} placeholder="Create a secure password" autoComplete="new-password" disabled={busy} />
        {touched && <PasswordRules value={pw} />}
        <AuthField id="pw2" label="Confirm password" type="password" value={pw2} onChange={setPw2} placeholder="Repeat your password" autoComplete="new-password" error={fieldErr.pw2} disabled={busy} />
        {error && <FormError message={error} />}
        <Btn type="submit" disabled={busy} css={ctaCss(busy)} hover="background:#24805F;transform:translateY(-1px)">
          {busy && <Spinner />} {busy ? "Creating account…" : "Create account"}
        </Btn>
      </form>
      {google && (
        <div style={s("display:flex;flex-direction:column;gap:18px")}>
          <div style={s("display:flex;align-items:center;gap:12px")}>
            <span style={s("flex:1;height:1px;background:#252B27")} />
            <span style={s("font-family:'Geist Mono',monospace;font-size:10.5px;letter-spacing:0.14em;color:#6B736E")}>OR</span>
            <span style={s("flex:1;height:1px;background:#252B27")} />
          </div>
          {/* The first Google sign-in creates the account (verified by Google), so this is also "sign up". */}
          <Btn disabled={busy || googleBusy} onClick={() => { setGoogleBusy(true); void signIn("google", { callbackUrl: "/overview" }); }} css={secondaryCss + ";height:46px;font-size:14px;gap:10px"} hover="background:#1A1F1C">
            <GoogleMark />{googleBusy ? "Connecting…" : "Sign up with Google"}
          </Btn>
        </div>
      )}
      <p style={s("margin:0;font-size:12px;line-height:1.6;color:#7C847F;text-wrap:pretty")}>By creating an account, you agree to the <A href="/terms" css="color:#9BA39E">Terms of Service</A> and <A href="/privacy" css="color:#9BA39E">Privacy Policy</A>.</p>
      <div style={s("padding-top:20px;border-top:1px solid #1D221F;font-size:13.5px;color:#9BA39E")}>
        Already have an account? <A href="/login" css="color:#4ADE80;font-weight:500">Sign in</A>
      </div>
    </AuthShell>
  );
}
