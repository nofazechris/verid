"use client";

import { useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { Btn, Field } from "@/components/ui";
import { Card, Empty, ErrorBox, Label, Loading, Mono, Spinner, ghostBtn, ghostHover, inputCss, primaryBtn, primaryHover, MONO } from "@/components/kit";
import { del, errorMessage, post } from "@/lib/client/api";
import { ago, fmtDateTime } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

export default function Keys() {
  const canAdmin = useCan("admin");
  const { toast } = useSession();
  const { data, error, loading, reload } = useApi<any>(canAdmin ? "/api-keys" : null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState("");

  if (!canAdmin) {
    return <Empty title="API keys are managed by admins" text="Ask a workspace admin or owner to create a key for you." />;
  }

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post<any>("/api-keys", { name: name.trim(), role, ...(days ? { expiresInDays: Number(days) } : {}) });
      setFresh({ key: r.key, name: r.name });
      setName("");
      reload();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? Anything using it will immediately stop working.")) return;
    setRevoking(id);
    try {
      await del(`/api-keys/${id}`);
      toast("Key revoked");
      reload();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setRevoking("");
    }
  };

  return (
    <div style={s("display:flex;flex-direction:column;gap:20px")}>
      {fresh && (
        <div style={s("border:1px solid #2C8A66;border-radius:12px;background:#0F1512;padding:20px 22px;display:flex;flex-direction:column;gap:12px;animation:apFade .3s ease both")}>
          <Label>NEW KEY “{fresh.name.toUpperCase()}” — COPY IT NOW</Label>
          <div style={s("display:flex;gap:10px;align-items:center;flex-wrap:wrap")}>
            <code style={s(`font-family:${MONO};font-size:12.5px;color:#E8ECE9;background:#0B0D0C;border:1px solid #1D221F;border-radius:8px;padding:10px 12px;overflow-wrap:anywhere;flex:1;min-width:260px`)}>{fresh.key}</code>
            <Btn onClick={() => { void navigator.clipboard?.writeText(fresh.key); toast("API key copied"); }} css={primaryBtn} hover={primaryHover}>Copy</Btn>
            <Btn onClick={() => setFresh(null)} css={ghostBtn} hover={ghostHover}>Done</Btn>
          </div>
          <span style={s("font-size:12.5px;color:#CDB274")}>This is the only time the full key is shown. Verid stores only a hash and cannot recover it. Treat it like a password.</span>
        </div>
      )}

      <Card gap={14}>
        <Label>CREATE KEY</Label>
        <form onSubmit={create} style={s("display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end")}>
          <label style={s("display:flex;flex-direction:column;gap:6px;flex:1;min-width:200px")}>
            <span style={s("font-size:12.5px;color:#9BA39E")}>Name</span>
            <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-pipeline" css={inputCss} focus="border-color:#2C8A66" />
          </label>
          <label style={s("display:flex;flex-direction:column;gap:6px")}>
            <span style={s("font-size:12.5px;color:#9BA39E")}>Access</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={s("height:36px;padding:0 10px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;font-size:13px")}>
              <option value="developer">Read &amp; write</option>
              <option value="viewer">Read only</option>
            </select>
          </label>
          <label style={s("display:flex;flex-direction:column;gap:6px")}>
            <span style={s("font-size:12.5px;color:#9BA39E")}>Expires (days, optional)</span>
            <Field value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} placeholder="never" css={inputCss + ";width:150px"} focus="border-color:#2C8A66" />
          </label>
          <Btn type="submit" disabled={busy || !name.trim()} css={primaryBtn} hover={primaryHover}>
            {busy ? <Spinner /> : null} Create key
          </Btn>
        </form>
        <span style={s("font-size:12px;color:#7C847F")}>Keys are scoped to this workspace and can never manage keys or members.</span>
      </Card>

      <Card pad={0}>
        {loading ? (
          <Loading />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : data.data.length === 0 ? (
          <div style={s("padding:22px;font-size:13.5px;color:#7C847F")}>No API keys yet.</div>
        ) : (
          data.data.map((k: any) => (
            <div key={k.id} style={s(`display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:20px;align-items:center;padding:16px 22px;border-bottom:1px solid #161A18;opacity:${k.revokedAt ? 0.5 : 1}`)}>
              <div style={s("display:flex;flex-direction:column;min-width:0")}>
                <span style={s("font-size:13.5px")}>
                  {k.name} {k.revokedAt && <Mono color="#D08A8A" size={11}>REVOKED</Mono>}
                </span>
                <span style={s("font-size:11.5px;color:#7C847F")}>
                  Created {fmtDateTime(k.createdAt).slice(0, 10)} · {k.lastUsedAt ? `used ${ago(k.lastUsedAt)}` : "never used"}
                  {k.expiresAt ? ` · expires ${fmtDateTime(k.expiresAt).slice(0, 10)}` : ""}
                </span>
              </div>
              <Mono color="#C8D0CB">verid_{k.keyPrefix}_••••••••</Mono>
              {!k.revokedAt && (
                <Btn onClick={() => revoke(k.id)} disabled={revoking === k.id} css="height:28px;padding:0 10px;border-radius:6px;border:1px solid #252B27;background:transparent;color:#D08A8A;font-size:12px;cursor:pointer" hover="background:#1A1616">
                  {revoking === k.id ? "Revoking…" : "Revoke"}
                </Btn>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
