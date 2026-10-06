"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { Btn } from "@/components/ui";
import { Spinner } from "@/components/kit";
import AuthShell, { AuthField, FormError, ctaCss } from "@/components/auth/AuthShell";
import { ApiClientError, post } from "@/lib/client/api";
import { slugify } from "@/lib/client/format";
import { useSession } from "@/lib/client/session";

export default function Onboarding() {
  const router = useRouter();
  const { status, me, refresh, setWorkspace } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "anon") router.replace("/login");
    else if (status === "authed" && me && !me.user.emailVerified) router.replace("/verify-email");
    else if (status === "authed" && me && me.workspaces.length > 0) router.replace("/overview");
  }, [status, me, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!name.trim()) return setError("Give your workspace a name.");
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return setError("URL handle must be 3–40 characters: lowercase letters, digits and hyphens.");
    setBusy(true);
    try {
      const r = await post<{ workspace: { id: string } }>("/workspaces", { name: name.trim(), slug });
      setWorkspace(r.workspace.id);
      await refresh();
      router.replace("/overview");
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiClientError && err.status === 409 ? "That handle is already taken. Try another." : err instanceof ApiClientError ? err.message : "Could not create the workspace.");
    }
  };

  return (
    <AuthShell title="Name your workspace." sub="A workspace holds your agents, executions and receipts. You can invite teammates later." foot="STEP 1 OF 1">
      <form onSubmit={submit} style={s("display:flex;flex-direction:column;gap:18px")} noValidate>
        <AuthField id="name" label="Workspace name" value={name} onChange={(v) => { setName(v); if (!slugTouched) setSlug(slugify(v)); }} placeholder="Acme Research" disabled={busy} />
        <AuthField id="slug" label="URL handle" value={slug} onChange={(v) => { setSlug(v.toLowerCase()); setSlugTouched(true); }} placeholder="acme-research" disabled={busy} />
        {error && <FormError message={error} />}
        <Btn type="submit" disabled={busy} css={ctaCss(busy)} hover="background:#24805F;transform:translateY(-1px)">
          {busy && <Spinner />} {busy ? "Creating…" : "Create workspace"}
        </Btn>
      </form>
    </AuthShell>
  );
}
