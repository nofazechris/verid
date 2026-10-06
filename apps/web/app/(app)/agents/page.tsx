"use client";

import { useState, type FormEvent } from "react";
import { s } from "@/lib/style";
import { A, Btn, Field } from "@/components/ui";
import ConnectAgent from "@/components/ConnectAgent";
import { Card, Empty, ErrorBox, Label, Loading, Mono, Page, PageTitle, Pill, Spinner, ghostBtn, ghostHover, inputCss, primaryBtn, primaryHover, MONO } from "@/components/kit";
import { ApiClientError, del, errorMessage, post } from "@/lib/client/api";
import { ago, healthBadge, slugify } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

/** Step 1 creates the record; step 2 shows how to make real software report to it, and waits for the first run. */
function AddAgent({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [version, setVersion] = useState("1.0.0");
  const [caps, setCaps] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ slug: string; name: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const finalSlug = slug || slugify(name);
    try {
      await post("/agents", { name: name.trim(), slug: finalSlug, version: version.trim(), capabilities: caps.split(",").map((c) => c.trim()).filter(Boolean) });
      toast("Agent added");
      setCreated({ slug: finalSlug, name: name.trim() });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const lbl = (t: string) => <span style={s("font-size:12.5px;color:#9BA39E")}>{t}</span>;

  if (created) {
    return (
      <Card gap={18} pad={24} css="border-color:#2C8A66;background:#0F1512;">
        <div style={s("display:flex;flex-direction:column;gap:6px")}>
          <span style={s("font-size:17px;font-weight:500")}>“{created.name}” is added. Now make it report in.</span>
          <span style={s("font-size:13.5px;color:#9BA39E;line-height:1.6;max-width:720px")}>
            An agent here is just a name for your software. It becomes useful the moment your code wraps its work in <Mono size={12.5}>verid.run(...)</Mono>: Verid then records what it does, validates the result, and watches its health. Copy this into your agent.
          </span>
        </div>
        <ConnectAgent slug={created.slug} compact />
        <div><Btn onClick={onClose} css={ghostBtn} hover={ghostHover}>Done</Btn></div>
      </Card>
    );
  }
  return (
    <Card gap={14}>
      <form onSubmit={submit} style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:14px")}>
        <label style={s("display:flex;flex-direction:column;gap:6px")}>{lbl("Name")}<Field value={name} onChange={(e) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} placeholder="Research Agent" css={inputCss} focus="border-color:#2C8A66" /></label>
        <label style={s("display:flex;flex-direction:column;gap:6px")}>{lbl("Handle (what your code calls it)")}<Field value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase()); setTouched(true); }} placeholder="research-agent" css={inputCss + ";font-family:'Geist Mono',monospace"} focus="border-color:#2C8A66" /></label>
        <label style={s("display:flex;flex-direction:column;gap:6px")}>{lbl("Version")}<Field value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" css={inputCss} focus="border-color:#2C8A66" /></label>
        <label style={s("display:flex;flex-direction:column;gap:6px")}>{lbl("What it can do (comma-separated, optional)")}<Field value={caps} onChange={(e) => setCaps(e.target.value)} placeholder="web.search, summarise" css={inputCss} focus="border-color:#2C8A66" /></label>
        {error && <span role="alert" style={s("grid-column:1 / -1;font-size:12.5px;color:#D08A8A")}>{error}</span>}
        <div style={s("grid-column:1 / -1;display:flex;gap:8px;align-items:center;flex-wrap:wrap")}>
          <Btn type="submit" disabled={busy || !name.trim() || !version.trim()} css={primaryBtn} hover={primaryHover}>{busy ? <Spinner /> : null} Add agent and get the code</Btn>
          <Btn onClick={onClose} css={ghostBtn} hover={ghostHover}>Cancel</Btn>
          <span style={s("font-size:12px;color:#7C847F")}>Your code can also create the agent itself on first run, so this step is optional.</span>
        </div>
      </form>
    </Card>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div style={s("min-width:0")}>
      <div style={s("font-size:11.5px;color:#7C847F")}>{k}</div>
      <div style={s(`font-family:${MONO};font-size:14px;margin-top:2px;color:${tone ?? "#E8ECE9"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{v}</div>
    </div>
  );
}

function AgentCard({ a, canWrite, onDeleted }: { a: any; canWrite: boolean; onDeleted: () => void }) {
  const { toast } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = a.monitoring ?? {};
  const archived = a.status === "inactive";
  const canDelete = canWrite && a.executions === 0;
  const passRate = m.recentPassRate === null || m.recentPassRate === undefined ? "—" : `${Math.round(m.recentPassRate * 100)}%`;

  const remove = async () => {
    setBusy(true);
    try {
      await del(`/agents/${a.id}`);
      toast("Agent deleted");
      onDeleted();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : errorMessage(e));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div style={s(`border:1px solid #252B27;border-radius:12px;background:#101311;display:flex;flex-direction:column;opacity:${archived ? 0.7 : 1}`)}>
      <A href={`/agents/${a.id}`} css="padding:22px 22px 16px;display:flex;flex-direction:column;gap:16px;color:#E8ECE9;border-radius:12px 12px 0 0;transition:background .15s ease" hover="background:#131714;color:#E8ECE9">
        <div style={s("display:flex;align-items:flex-start;gap:12px")}>
          <div style={s("display:flex;flex-direction:column;gap:2px;min-width:0")}>
            <span style={s("font-size:17px;font-weight:500;overflow:hidden;text-overflow:ellipsis")}>{a.name}</span>
            <span style={s(`font-family:${MONO};font-size:12px;color:#7C847F`)}>{a.slug} · v{a.version}</span>
          </div>
          <span style={s("margin-left:auto;flex:none")}>{archived ? <Pill b={{ label: "ARCHIVED", icon: "○", fg: "#9BA39E", bg: "rgba(155,163,158,0.05)", bd: "#303832" }} /> : <Pill b={healthBadge(m.health)} />}</span>
        </div>
        <span style={s("font-size:12.5px;color:#9BA39E;line-height:1.5;min-height:19px")}>{archived ? "Archived: history is kept, it no longer shows as active." : m.healthReason}</span>
        <div style={s("display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding-top:14px;border-top:1px solid #1D221F")}>
          <Stat k="Runs" v={String(a.executions)} />
          <Stat k="Last 24h" v={String(m.last24h ?? 0)} />
          <Stat k="Pass rate" v={passRate} tone={m.health === "failing" ? "#D08A8A" : m.health === "degraded" ? "#CDB274" : undefined} />
          <Stat k="Last run" v={a.executions ? ago(a.lastExecutionAt) : "never"} />
        </div>
        {m.stuckRuns > 0 && <span style={s("font-size:12px;color:#CDB274")}>⚠ {m.stuckRuns} run{m.stuckRuns === 1 ? "" : "s"} started but stopped progressing over an hour ago.</span>}
      </A>
      {canDelete && (
        <div style={s("display:flex;align-items:center;gap:8px;padding:10px 22px;border-top:1px solid #1D221F;min-height:46px")}>
          {confirming ? (
            <>
              <span style={s("font-size:12.5px;color:#D08A8A")}>Delete “{a.name}”? It has never run, so nothing is lost.</span>
              <Btn onClick={remove} disabled={busy} css="margin-left:auto;height:28px;padding:0 12px;border-radius:7px;border:1px solid rgba(166,93,93,0.5);background:rgba(166,93,93,0.12);color:#D08A8A;font-size:12.5px;cursor:pointer" hover="background:rgba(166,93,93,0.2)">{busy ? "Deleting…" : "Delete"}</Btn>
              <Btn onClick={() => setConfirming(false)} css={ghostBtn + ";height:28px;font-size:12.5px;padding:0 12px"} hover={ghostHover}>Keep</Btn>
            </>
          ) : (
            <>
              <span style={s("font-size:12px;color:#7C847F")}>Never ran: safe to delete.</span>
              <Btn onClick={() => setConfirming(true)} css="margin-left:auto;height:28px;padding:0 12px;border-radius:7px;border:1px solid #252B27;background:transparent;color:#9BA39E;font-size:12.5px;cursor:pointer" hover="color:#D08A8A;border-color:rgba(166,93,93,0.4)">Delete</Btn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  const canWrite = useCan("developer");
  const { data, error, loading, reload } = useApi<any>("/agents?limit=100", { pollMs: 10_000 });
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const all: any[] = data?.data ?? [];
  const shown = all.filter((a) => showArchived || a.status === "active");
  const archivedCount = all.filter((a) => a.status === "inactive").length;

  return (
    <Page>
      <PageTitle
        title="Agents"
        sub="Your software that does work, and whether it is healthy. Each agent reports its runs here; Verid validates them and tells you when something goes wrong."
        right={canWrite && !adding ? <Btn onClick={() => setAdding(true)} css={primaryBtn} hover={primaryHover}>Add agent</Btn> : undefined}
      />
      {adding && <AddAgent onClose={() => setAdding(false)} onCreated={reload} />}

      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : all.length === 0 ? (
        <Empty
          title="No agents yet"
          text="An agent is the name of a piece of your software that does work. Add one, copy the two-minute snippet into your code, and its runs, evidence and health appear here. You can also let your code create it on first run."
          action={canWrite && !adding ? <Btn onClick={() => setAdding(true)} css={primaryBtn} hover={primaryHover}>Add your first agent</Btn> : <A href="/get-started" css="color:#4ADE80;font-size:13.5px">Open the walkthrough</A>}
        />
      ) : (
        <>
          <div style={s("display:grid;grid-template-columns:repeat(auto-fill,minmax(min(380px,100%),1fr));gap:16px")}>
            {shown.map((a) => <AgentCard key={a.id} a={a} canWrite={canWrite} onDeleted={reload} />)}
          </div>
          {archivedCount > 0 && (
            <Btn onClick={() => setShowArchived((x) => !x)} css={ghostBtn + ";align-self:flex-start"} hover={ghostHover}>{showArchived ? "Hide" : "Show"} {archivedCount} archived</Btn>
          )}
          <Card pad={16}>
            <Label>HOW AGENT HEALTH IS READ</Label>
            <p style={s("margin:8px 0 0;font-size:12.5px;line-height:1.6;color:#9BA39E")}>
              Health is a plain reading of the most recent finished runs, never a score: <b style={{ color: "#C8D0CB", fontWeight: 500 }}>failing</b> when the last 3 all failed (a failed validation or the agent crashing), <b style={{ color: "#C8D0CB", fontWeight: 500 }}>degraded</b> when fewer than 80% of the last 10 passed. A pass means the result met the validator’s rules, not that it is true. An agent that has run cannot be deleted (its history is a permanent record), but it can be archived.
            </p>
          </Card>
        </>
      )}
    </Page>
  );
}
