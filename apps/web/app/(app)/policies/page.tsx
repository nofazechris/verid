"use client";

import { useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { Btn, Field, Area } from "@/components/ui";
import { Card, Empty, ErrorBox, KV, Label, Loading, Mono, Page, PageTitle, Spinner, ghostBtn, ghostHover, inputCss, primaryBtn, primaryHover, MONO } from "@/components/kit";
import { errorMessage, patch, post } from "@/lib/client/api";
import { fmtDateTime, short, slugify } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

function PolicyForm({ base, onDone }: { base?: any; onDone: () => void }) {
  const { toast } = useSession();
  const [name, setName] = useState(base?.name ?? "");
  const [slug, setSlug] = useState(base?.slug ?? "");
  const [touched, setTouched] = useState(false);
  const [rules, setRules] = useState(JSON.stringify(base?.definition?.rules ?? { allowedTools: ["search"], maxRecords: 20 }, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rules);
    } catch {
      return setError("Rules must be valid JSON.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return setError("Rules must be a JSON object.");
    setBusy(true);
    setError("");
    try {
      if (base) await patch(`/policies/${base.id}`, { name: name.trim(), rules: parsed });
      else await post("/policies", { slug, name: name.trim(), rules: parsed });
      toast(base ? "New policy version created" : "Policy created");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Card gap={14}>
      <form onSubmit={submit} style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px")}>
        <label style={s("display:flex;flex-direction:column;gap:6px")}><span style={s("font-size:12.5px;color:#9BA39E")}>Name</span><Field value={name} onChange={(e) => { setName(e.target.value); if (!touched && !base) setSlug(slugify(e.target.value)); }} css={inputCss} focus="border-color:#2C8A66" /></label>
        <label style={s("display:flex;flex-direction:column;gap:6px")}><span style={s("font-size:12.5px;color:#9BA39E")}>Handle {base && "(fixed)"}</span><Field value={slug} disabled={!!base} onChange={(e) => { setSlug(e.target.value.toLowerCase()); setTouched(true); }} css={inputCss} focus="border-color:#2C8A66" /></label>
        <label style={s("display:flex;flex-direction:column;gap:6px;grid-column:1 / -1")}><span style={s("font-size:12.5px;color:#9BA39E")}>Rules (JSON)</span><Area value={rules} onChange={(e) => setRules(e.target.value)} spellCheck={false} css={inputCss + `;height:150px;padding:10px 12px;resize:vertical;font-family:${MONO};font-size:12.5px`} /></label>
        {error && <span role="alert" style={s("grid-column:1 / -1;font-size:12.5px;color:#D08A8A")}>{error}</span>}
        <div style={s("grid-column:1 / -1;display:flex;gap:8px")}>
          <Btn type="submit" disabled={busy || !name.trim() || !slug} css={primaryBtn} hover={primaryHover}>{busy ? <Spinner /> : null} {base ? "Create new version" : "Create policy"}</Btn>
          <Btn onClick={onDone} css={ghostBtn} hover={ghostHover}>Cancel</Btn>
        </div>
      </form>
      <span style={s("font-size:12px;color:#7C847F;line-height:1.5")}>Policies are immutable. {base ? "Saving creates a new version; past executions keep the exact version they ran under." : "Editing later creates a new version."} Recording a policy proves which rules were declared, not that an agent obeyed them.</span>
    </Card>
  );
}

export default function Policies() {
  const canWrite = useCan("developer");
  const { data, error, loading, reload } = useApi<any>("/policies?limit=100");
  const [form, setForm] = useState<null | "new" | any>(null);

  return (
    <Page>
      <PageTitle title="Policies" sub="What an agent is declared to be allowed to do. Each execution records the exact policy hash it ran under."
        right={canWrite && !form ? <Btn onClick={() => setForm("new")} css={primaryBtn} hover={primaryHover}>New policy</Btn> : undefined} />
      {form && <PolicyForm base={form === "new" ? undefined : form} onDone={() => { setForm(null); reload(); }} />}
      {error ? <ErrorBox error={error} retry={reload} /> : loading ? <Loading /> : data.data.length === 0 ? (
        <Empty title="No policies yet" text="Create a policy to declare the rules an agent runs under. It is optional." />
      ) : (
        <div style={s("display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px")}>
          {data.data.map((p: any) => (
            <Card key={p.id} pad={24} gap={16}>
              <div style={s("display:flex;align-items:flex-start;gap:12px")}>
                <div style={s("display:flex;flex-direction:column;gap:2px;min-width:0")}>
                  <span style={s("font-size:16px;font-weight:500")}>{p.name}</span>
                  <span style={s(`font-family:${MONO};font-size:12px;color:#7C847F`)}>{p.slug} · v{p.version} · {fmtDateTime(p.createdAt).slice(0, 10)}</span>
                </div>
                {canWrite && <Btn onClick={() => setForm(p)} css={ghostBtn + ";margin-left:auto;height:30px;font-size:12.5px"} hover={ghostHover}>New version</Btn>}
              </div>
              <KV rows={[["Policy hash", <Mono key="h">{short(p.policyHash, 10, 6)}</Mono>], ["Used by", <Mono key="u">{p.executionCount} execution{p.executionCount === 1 ? "" : "s"}</Mono>]]} />
              <div style={s("display:flex;flex-direction:column;gap:6px")}>
                <Label>RULES</Label>
                <pre style={s(`margin:0;padding:12px 14px;border:1px solid #1D221F;border-radius:8px;background:#0B0D0C;font-family:${MONO};font-size:12px;line-height:1.6;color:#C8D0CB;overflow-x:auto;max-height:180px`)}>{JSON.stringify(p.definition.rules, null, 2)}</pre>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
