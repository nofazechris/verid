"use client";

import { useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Spinner } from "@/components/kit";
import AuthShell, { AuthField, FormError, ctaCss } from "@/components/auth/AuthShell";
import { ApiClientError, post } from "@/lib/client/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      await post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiClientError && err.status === 429 ? "Too many requests. Please wait a minute." : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your inbox." sub={<>If an account exists for <b style={{ color: "#E8ECE9" }}>{email}</b>, we’ve sent a secure reset link.</>} foot="LINK EXPIRES IN 30 MINUTES">
        <A href="/login" css="height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #303832;color:#E8ECE9;font-size:14px">Back to sign in</A>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Reset your password." sub="Enter your email and we’ll send you a secure reset link." foot="VERID · ACCOUNT RECOVERY">
      <form onSubmit={submit} style={s("display:flex;flex-direction:column;gap:18px")} noValidate>
        <AuthField id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" autoComplete="email" disabled={busy} />
        {error && <FormError message={error} />}
        <Btn type="submit" disabled={busy} css={ctaCss(busy)} hover="background:#24805F;transform:translateY(-1px)">
          {busy && <Spinner />} {busy ? "Sending…" : "Send reset link"}
        </Btn>
      </form>
      <div style={s("padding-top:20px;border-top:1px solid #1D221F;font-size:13.5px;color:#9BA39E")}>
        Remembered it? <A href="/login" css="color:#4ADE80;font-weight:500">Back to sign in</A>
      </div>
    </AuthShell>
  );
}
