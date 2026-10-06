"use client";

import { useState } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import ValidatorEditor from "@/components/ValidatorEditor";
import { Card, ErrorBox, Label, Loading, Mono, Page, PageTitle, ghostBtn, ghostHover, primaryBtn, primaryHover, MONO } from "@/components/kit";
import { short } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

type Editing = { mode: "new" } | { mode: "version"; v: any } | null;

export default function Validators() {
  const { data, error, loading, reload } = useApi<any>("/validators");
  const canWrite = useCan("developer");
  const { toast } = useSession();
  const [editing, setEditing] = useState<Editing>(null);

  const done = () => {
    setEditing(null);
    reload();
  };

  return (
    <Page>
      <PageTitle
        title="Validators"
        sub="What each validator actually checks, and how its results have turned out in this workspace."
        right={canWrite && !editing ? <Btn onClick={() => setEditing({ mode: "new" })} css={primaryBtn} hover={primaryHover}>New validator</Btn> : undefined}
      />

      {editing && (
        <ValidatorEditor
          existing={editing.mode === "version" ? { slug: editing.v.slug, name: editing.v.name, description: editing.v.description, definition: editing.v.definition, version: editing.v.version } : undefined}
          onDone={done}
          onCancel={() => setEditing(null)}
        />
      )}

      {error ? <ErrorBox error={error} retry={reload} /> : loading ? <Loading /> : (
        <div style={s("display:flex;flex-direction:column;gap:14px")}>
          {data.data.map((v: any) => {
            const pass = v.outcomes.pass ?? 0, fail = v.outcomes.fail ?? 0, inc = v.outcomes.inconclusive ?? 0;
            const mine = v.origin === "workspace";
            return (
              <Card key={v.id} pad={24} gap={18}>
                <div style={s("display:flex;align-items:baseline;gap:12px;flex-wrap:wrap")}>
                  <span style={s("font-size:18px;font-weight:500")}>{v.name}</span>
                  <Mono color="#7C847F">{v.id}@{mine ? v.versionLabel : v.version}</Mono>
                  <span style={s(`display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:5px;font-family:${MONO};font-size:10.5px;letter-spacing:0.06em;border:1px solid ${mine ? "rgba(205,178,116,0.35)" : "#303832"};color:${mine ? "#CDB274" : "#9BA39E"}`)}>{mine ? "DEFINED BY THIS WORKSPACE" : "VERID BUILT-IN"}</span>
                  <span style={s(`margin-left:auto;font-family:${MONO};font-size:12px;color:#9BA39E`)}>{mine ? "Workspace-defined rules" : v.method}</span>
                </div>
                {v.description && <p style={s("margin:0;color:#9BA39E;font-size:13.5px;line-height:1.6;max-width:760px")}>{v.description}</p>}
                <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:24px")}>
                  <div style={s("display:flex;flex-direction:column;gap:8px")}>
                    <Label>RULES (VERSIONED)</Label>
                    <ul style={s("margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:13px;color:#C8D0CB;line-height:1.5")}>
                      {v.rules.map((r: string, i: number) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                  <div style={s("display:flex;flex-direction:column;gap:12px")}>
                    <Label>OUTCOMES IN THIS WORKSPACE</Label>
                    <div style={s("display:flex;gap:24px")}>
                      <div><div style={s("font-size:12px;color:#7C847F")}>Pass</div><div style={s("font-size:24px;font-weight:600;color:#4ADE80")}>{pass}</div></div>
                      <div><div style={s("font-size:12px;color:#7C847F")}>Fail</div><div style={s("font-size:24px;font-weight:600;color:#D08A8A")}>{fail}</div></div>
                      <div><div style={s("font-size:12px;color:#7C847F")}>Inconclusive</div><div style={s("font-size:24px;font-weight:600;color:#CDB274")}>{inc}</div></div>
                    </div>
                    {!mine && <span style={s("font-size:12px;color:#7C847F")}>Supports: {v.supportedTasks}</span>}
                  </div>
                </div>

                {mine && (
                  <div style={s("display:flex;flex-direction:column;gap:12px;padding-top:16px;border-top:1px solid #1D221F")}>
                    <div style={s("display:flex;gap:10px;flex-wrap:wrap;align-items:center")}>
                      <Label>USE IT</Label>
                      <Mono size={12}>{`{ "executionId": "…", "validatorId": "${v.id}" }`}</Mono>
                      <Btn onClick={() => { void navigator.clipboard?.writeText(v.id); toast("Validator ID copied"); }} css={ghostBtn + ";height:26px;font-size:12px;padding:0 10px"} hover={ghostHover}>Copy ID</Btn>
                      {canWrite && !editing && <Btn onClick={() => setEditing({ mode: "version", v })} css={ghostBtn + ";height:26px;font-size:12px;padding:0 10px;margin-left:auto"} hover={ghostHover}>New version</Btn>}
                    </div>
                    <span style={s("font-size:12px;color:#7C847F;line-height:1.55")}>
                      Rules hash <Mono size={12}>{short(v.definitionHash, 10, 6)}</Mono>. Pin an exact version with <Mono size={12}>{v.id}@{v.version}</Mono>; without a version the latest is used. {v.versions?.length > 1 ? `${v.versions.length} versions exist, and older ones are never changed.` : "Editing creates a new version; this one will never change."}
                    </span>
                  </div>
                )}

                <div style={s("padding:12px 14px;border:1px solid #252B27;border-radius:8px;background:#0F1210;font-size:12.5px;color:#9BA39E;line-height:1.55")}>
                  {mine
                    ? <>A pass means these rules, <b style={{ color: "#C8D0CB", fontWeight: 500 }}>written by this workspace</b>, found the result well-formed. Anyone relying on a receipt, including a payer funding an escrow, should read the rules, because the party who builds the agent can also write them. It never confirms real-world truth. See <A href="/docs/validators" css="color:#4ADE80">Validators</A>.</>
                    : <>A passing result means this validator returned “pass” under these rules. It does not establish that the validator is independent or correct, and it never confirms real-world truth. Verid shows counts, not a reputation score.</>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
