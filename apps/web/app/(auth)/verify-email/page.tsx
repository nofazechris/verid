"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import AuthShell, { FormError, secondaryCss } from "@/components/auth/AuthShell";
import { ApiClientError, get, post } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";

const primary = "height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #2C8A66;background:#1F6B4F;color:#E8ECE9;font-size:14px;font-weight:500;cursor:pointer;transition:background .18s ease";

function VerifyEmail() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const { status, me, refresh, signOut, toast } = useSession();
  const [phase, setPhase] = useState<"idle" | "verifying" | "ok" | "bad">(token ? "verifying" : "idle");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [devLink, setDevLink] = useState<string | null>(null);
  const ran = useRef(false);

  const nextStep = useCallback(
    (m: Awaited<ReturnType<typeof refresh>>) => router.replace(m && m.workspaces.length === 0 ? "/onboarding" : "/overview"),
    [router],
  );

  // 1) Arriving from the email link.
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    post("/auth/verify-email", { token })
      .then(async () => {
        setPhase("ok");
        await refresh();
      })
      .catch(() => setPhase("bad"));
  }, [token, refresh]);

  // 2) Waiting for the user to click the link.
  useEffect(() => {
    if (token) return;
    if (status === "anon") router.replace("/login");
    else if (status === "authed" && me?.user.emailVerified) nextStep(me);
  }, [token, status, me, router, nextStep]);

  // Development convenience: when no email provider is configured the server keeps an in-memory outbox.
  useEffect(() => {
    if (token || !me || me.user.emailVerified) return;
    get<{ data: { to: string; text: string }[] }>("/dev/outbox")
      .then((r) => {
        const mail = [...r.data].reverse().find((m) => m.to === me.user.email);
        const link = mail && /https?:\/\/\S+/.exec(mail.text)?.[0];
        if (link) setDevLink(link);
      })
      .catch(() => {}); // 404 in production: nothing to show
  }, [token, me]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (token) {
    if (phase === "verifying") return <AuthShell title="Verifying your email…" sub="One moment." foot="VERID · ACCOUNT"><span /></AuthShell>;
    if (phase === "ok") {
      return (
        <AuthShell title="Email verified." sub="Your account is ready." foot="VERID · ACCOUNT">
          <span style={s("display:flex;align-items:center;gap:10px;font-family:'Geist Mono',monospace;font-size:12px;letter-spacing:0.08em;color:#4ADE80")}>✓ EMAIL VERIFIED</span>
          <Btn onClick={() => (status === "authed" ? router.push(me && me.workspaces.length === 0 ? "/onboarding" : "/overview") : router.push("/login"))} css={primary} hover="background:#24805F">Continue to Verid</Btn>
        </AuthShell>
      );
    }
    return (
      <AuthShell title="This link isn’t valid." sub="Verification links expire after 24 hours and can be used once." foot="VERID · ACCOUNT">
        <A href="/login" css="height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;border:1px solid #2C8A66;background:#1F6B4F;color:#E8ECE9;font-size:14px;font-weight:500">Sign in to request a new link</A>
      </AuthShell>
    );
  }

  const email = me?.user.email ?? "";
  const resend = async () => {
    if (cooldown > 0 || !email) return;
    setError("");
    try {
      await post("/auth/resend-verification", { email });
      toast("Verification email sent");
      setCooldown(30);
    } catch (e) {
      setError(e instanceof ApiClientError && e.status === 429 ? "Too many requests. Please wait a minute." : "Could not send the email. Try again.");
    }
  };
  const check = async () => {
    const m = await refresh();
    if (m?.user.emailVerified) nextStep(m);
    else toast("Not verified yet. Open the link in your email.");
  };

  return (
    <AuthShell title="Verify your email." sub="We’ve sent a verification link to" foot={cooldown > 0 ? `RESEND AVAILABLE IN ${cooldown}S` : "RESEND AVAILABLE"}>
      <span style={s("font-family:'Geist Mono',monospace;font-size:13px;color:#E8ECE9;margin-top:-10px")}>{email || "your inbox"}</span>
      {error && <FormError message={error} />}
      <div style={s("display:flex;flex-direction:column;gap:10px")}>
        <Btn onClick={check} css={primary} hover="background:#24805F">I’ve verified my email</Btn>
        <Btn onClick={resend} disabled={cooldown > 0} css={secondaryCss + `;opacity:${cooldown > 0 ? 0.45 : 1};cursor:${cooldown > 0 ? "default" : "pointer"}`} hover="background:#1A1F1C">
          {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend email"}
        </Btn>
        <Btn onClick={async () => { await signOut(); router.push("/signup"); }} css={secondaryCss} hover="background:#1A1F1C">Change email</Btn>
      </div>
      {devLink && (
        <div style={s("padding:12px 14px;border:1px dashed #303832;border-radius:10px;font-size:12.5px;color:#9BA39E;line-height:1.55")}>
          <b style={{ color: "#CDB274" }}>Development mode:</b> no email provider is configured, so the email was not sent.{" "}
          <a href={devLink} style={{ color: "#4ADE80" }}>Open the verification link</a>.
        </div>
      )}
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
