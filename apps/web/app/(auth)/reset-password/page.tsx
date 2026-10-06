"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Spinner } from "@/components/kit";
import AuthShell, { AuthField, FormError, PasswordRules, ctaCss, passwordOk } from "@/components/auth/AuthShell";
import { ApiClientError, post } from "@/lib/client/api";

function Reset() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState("");
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthShell title="This link isn’t valid." sub="Reset links come from the email we send you. Request a new one to continue." foot="VERID · ACCOUNT RECOVERY">
        <A href="/forgot-password" css="height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #2C8A66;background:#1F6B4F;color:#E8ECE9;font-size:14px;font-weight:500">Request a new link</A>
      </AuthShell>
    );
  }
  if (done) {
    return (
      <AuthShell title="Password updated." sub="Your password has been changed. All other sessions were signed out." foot="ALL OTHER SESSIONS SIGNED OUT">
        <Btn onClick={() => router.push("/login")} css="height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #2C8A66;background:#1F6B4F;color:#E8ECE9;font-size:14px;font-weight:500;cursor:pointer" hover="background:#24805F">Continue to Verid</Btn>
      </AuthShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setFieldErr("");
    if (!passwordOk(pw)) {
      setTouched(true);
      return setError("Password does not meet the requirements.");
    }
    if (pw !== pw2) return setFieldErr("Passwords do not match.");
    setBusy(true);
    try {
      await post("/auth/reset-password", { token, password: pw });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError && err.status === 400 ? "This reset link is invalid or has expired. Request a new one." : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create a new password." sub="Choose a password you haven’t used before." foot="VERID · ACCOUNT RECOVERY">
      <form onSubmit={submit} style={s("display:flex;flex-direction:column;gap:18px")} noValidate>
        <AuthField id="pw" label="New password" type="password" value={pw} onChange={(v) => { setPw(v); setTouched(true); }} placeholder="Create a secure password" autoComplete="new-password" disabled={busy} />
        {touched && <PasswordRules value={pw} />}
        <AuthField id="pw2" label="Confirm new password" type="password" value={pw2} onChange={setPw2} placeholder="Repeat your password" autoComplete="new-password" error={fieldErr} disabled={busy} />
        {error && <FormError message={error} />}
        <Btn type="submit" disabled={busy} css={ctaCss(busy)} hover="background:#24805F;transform:translateY(-1px)">
          {busy && <Spinner />} {busy ? "Updating…" : "Update password"}
        </Btn>
      </form>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
