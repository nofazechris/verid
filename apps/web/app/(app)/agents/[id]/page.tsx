"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { s } from "@/lib/style";
import { A, Btn, Field, Area } from "@/components/ui";
import ConnectAgent from "@/components/ConnectAgent";
import { Card, Empty, ErrorBox, KV, Label, Loading, Mono, Page, Pill, Spinner, Table, ghostBtn, ghostHover, inputCss, primaryBtn, primaryHover, rowCss, MONO } from "@/components/kit";
import { ApiClientError, del, errorMessage, patch } from "@/lib/client/api";
import { ago, executionBadge, fmtDateTime, healthBadge, short, validationBadge } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

const TABS = [["overview", "Overview"], ["runs", "Runs"], ["connect", "Connect"], ["settings", "Settings"], ["identity", "Identity"]] as const;
type Tab = (typeof TABS)[number][0];
const COLS = "130px minmax(0,1fr) 190px 130px 90px";

/** Runs per day for the last 14 days: green = passed, red = failed (validation or the agent crashed), grey = still open. */
function Chart({ series }: { series: { date: string; total: number; pass: number; fail: number }[] }) {
  const max = Math.max(1, ...series.map((d) => d.total));
  const W = 560, H = 120, bw = W / series.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label="Runs per day for the last 14 days" style={{ display: "block" }}>
      {series.map((d, i) => {
        const open = d.total - d.pass - d.fail;
        const h = (n: number) => (n / max) * (H - 8);
        let y = H;
        const bar = (n: number, fill: string) => {
          const hh = h(n);
          y -= hh;
          return n ? <rect key={fill} x={i * bw + 5} y={y} width={bw - 10} height={hh} rx={2} fill={fill} /> : null;
        };
        return (
          <g key={d.date}>
            <title>{`${d.date}: ${d.total} run${d.total === 1 ? "" : "s"} (${d.pass} passed, ${d.fail} failed)`}</title>
            <rect x={i * bw + 5} y={H - 2} width={bw - 10} height={2} fill="#1D221F" />
            {bar(d.pass, "#2C8A66")}{bar(d.fail, "#A65D5D")}{bar(open, "#3A443D")}
            {(i % 2 === 0 || i === series.length - 1) && <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" fontSize="10" fill="#6B736E" fontFamily="'Geist Mono',monospace">{d.date.slice(8)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Tile({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div style={s("padding:20px 22px;min-width:0;border-right:1px solid #1D221F")}>
      <div style={s("font-size:13px;color:#9BA39E")}>{k}</div>
      <div style={s(`font-size:26px;font-weight:600;margin-top:4px;color:${tone ?? "#E8ECE9"};font-variant-numeric:tabular-nums`)}>{v}</div>
      {sub && <div style={s(`font-family:${MONO};font-size:11.5px;color:#7C847F;margin-top:2px`)}>{sub}</div>}
    </div>
  );
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const canWrite = useCan("developer");
  const { toast } = useSession();
  const agent = useApi<{ agent: any }>(`/agents/${id}`, { pollMs: 8000 });
  const execs = useApi<any>(`/executions?agentId=${id}&limit=50`, { pollMs: 8000 });
  const [tab, setTab] = useState<Tab>("overview");

  if (agent.loading && !agent.data) return <Page><Loading /></Page>;
  if (agent.error && !agent.data) {
    const notFound = (agent.error as { status?: number }).status === 404;
    return <Page>{notFound ? <Empty title="Agent not found" text="It may belong to another workspace, or it was deleted." action={<A href="/agents" css="color:#4ADE80;font-size:13.5px">Back to agents</A>} /> : <ErrorBox error={agent.error} retry={agent.reload} />}</Page>;
  }
  const a = agent.data!.agent;
  const m = a.monitoring ?? {};
  const archived = a.status === "inactive";
  const passRate = m.recentPassRate === null || m.recentPassRate === undefined ? "—" : `${Math.round(m.recentPassRate * 100)}%`;
  const dur = m.avgDurationSeconds == null ? "—" : m.avgDurationSeconds < 60 ? `${m.avgDurationSeconds}s` : `${Math.round(m.avgDurationSeconds / 6) / 10}m`;

  return (
    <Page>
      <div style={s("display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap")}>
        <div style={s("display:flex;flex-direction:column;gap:8px;min-width:0")}>
          <div style={s("display:flex;align-items:center;gap:14px;flex-wrap:wrap")}>
            <h1 style={s("margin:0;font-size:32px;letter-spacing:-0.025em;font-weight:600")}>{a.name}</h1>
            {archived ? <Pill large b={{ label: "ARCHIVED", icon: "○", fg: "#9BA39E", bg: "rgba(155,163,158,0.05)", bd: "#303832" }} /> : <Pill large b={healthBadge(m.health)} />}
          </div>
          <span style={s(`font-family:${MONO};font-size:13px;color:#9BA39E;overflow-wrap:anywhere`)}>{a.slug} · v{a.version} · {a.id}</span>
          {a.description && <p style={s("margin:0;color:#9BA39E")}>{a.description}</p>}
          {!archived && <span style={s("font-size:13px;color:#9BA39E")}>{m.healthReason}</span>}
        </div>
      </div>

      <div role="tablist" style={s("display:flex;gap:24px;border-bottom:1px solid #1D221F;overflow-x:auto")}>
        {TABS.map(([t, label]) => (
          <Btn key={t} onClick={() => setTab(t)} css={`height:40px;padding:0;background:transparent;border:0;border-bottom:1px solid ${tab === t ? "#E8ECE9" : "transparent"};margin-bottom:-1px;color:${tab === t ? "#E8ECE9" : "#7C847F"};font-size:13.5px;cursor:pointer;white-space:nowrap`} hover="color:#E8ECE9">{label}</Btn>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {a.executions === 0 ? (
            <Card gap={14} pad={24} css="border-color:#2C8A66;background:#0F1512;">
              <span style={s("font-size:16px;font-weight:500")}>This agent has not reported a run yet.</span>
              <span style={s("font-size:13.5px;color:#9BA39E;line-height:1.6;max-width:680px")}>Health, pass rate and the activity chart fill in from real runs. Connect your code to start.</span>
              <div><Btn onClick={() => setTab("connect")} css={primaryBtn} hover={primaryHover}>Show me the code</Btn></div>
            </Card>
          ) : (
            <>
              <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));border:1px solid #252B27;border-radius:12px;background:#101311;overflow:hidden")}>
                <Tile k="Total runs" v={String(a.executions)} sub={`${a.validated} validated`} />
                <Tile k="Last 24 hours" v={String(m.last24h ?? 0)} sub={`last run ${ago(m.lastRunAt)}`} />
                <Tile k="Recent pass rate" v={passRate} sub={m.recentRuns ? `of the last ${Math.min(10, m.recentRuns)} finished` : undefined} tone={m.health === "failing" ? "#D08A8A" : m.health === "degraded" ? "#CDB274" : undefined} />
                <Tile k="Average run time" v={dur} />
              </div>

              {m.stuckRuns > 0 && (
                <div style={s("padding:12px 14px;border:1px solid rgba(184,154,90,0.35);border-radius:10px;background:#1A1710;font-size:13px;color:#CDB274;line-height:1.55")}>
                  ⚠ {m.stuckRuns} run{m.stuckRuns === 1 ? "" : "s"} started but stopped progressing more than an hour ago. The agent may have hung. If it crashed, have it call <Mono size={12}>executions.fail</Mono> (the SDK does this for you).
                </div>
              )}

              {m.lastFailure && (
                <Card gap={8} css="border-color:rgba(166,93,93,0.3);background:#140F0F;">
                  <Label>LAST FAILURE</Label>
                  <span style={s("font-size:14px")}>{m.lastFailure.kind === "agent_error" ? "The agent itself failed" : "A validator rejected the result"}, {ago(m.lastFailure.at)}.</span>
                  <span style={s(`font-family:${MONO};font-size:12.5px;color:#D08A8A;overflow-wrap:anywhere`)}>{m.lastFailure.message}</span>
                  <A href={`/executions/${m.lastFailure.executionId}`} css="color:#4ADE80;font-size:13px">Inspect that run →</A>
                </Card>
              )}

              <Card gap={10}>
                <div style={s("display:flex;align-items:center;gap:14px;flex-wrap:wrap")}>
                  <Label>RUNS PER DAY, LAST 14 DAYS</Label>
                  <span style={s("margin-left:auto;display:flex;gap:14px;font-size:11.5px;color:#7C847F")}>
                    <span><span style={{ color: "#2C8A66" }}>■</span> passed</span><span><span style={{ color: "#A65D5D" }}>■</span> failed</span><span><span style={{ color: "#3A443D" }}>■</span> open</span>
                  </span>
                </div>
                <Chart series={m.series ?? []} />
              </Card>

              <div>
                <div style={s("margin-bottom:12px")}><Label>RECENT RUNS</Label></div>
                <Table cols={COLS} head={["EXECUTION", "OUTCOME", "STATUS", "VALIDATION", "STARTED"]} minWidth={760}>
                  {(m.recent ?? []).map((r: any) => (
                    <A key={r.id} href={`/executions/${r.id}`} css={rowCss(COLS, 48)} hover="background:#151917;color:#E8ECE9">
                      <Mono>{short(r.id, 10, 4)}</Mono>
                      <span style={s("font-size:13px;color:#9BA39E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.error ?? (r.validation ? `validation ${r.validation}` : "in progress")}</span>
                      <span><Pill b={executionBadge(r.status)} /></span><span><Pill b={validationBadge(r.validation)} /></span>
                      <Mono color="#7C847F" size={12}>{ago(r.createdAt)}</Mono>
                    </A>
                  ))}
                </Table>
              </div>
            </>
          )}
          <Card gap={10}>
            <Label>CAPABILITIES</Label>
            <div style={s("display:flex;gap:6px;flex-wrap:wrap")}>
              {a.capabilities.length ? a.capabilities.map((c: string) => <span key={c} style={s(`height:26px;display:inline-flex;align-items:center;padding:0 10px;border-radius:6px;background:#151917;border:1px solid #252B27;font-family:${MONO};font-size:12px`)}>{c}</span>) : <span style={s("color:#7C847F;font-size:13px")}>None declared.</span>}
            </div>
            <span style={s("font-size:12px;color:#7C847F")}>Self-declared by the agent’s operator. Verid records them; it does not verify them.</span>
          </Card>
        </>
      )}

      {tab === "runs" && (
        execs.loading && !execs.data ? <Loading /> : execs.error ? <ErrorBox error={execs.error} retry={execs.reload} /> : (
          <Table cols={COLS} head={["EXECUTION", "TASK", "STATUS", "VALIDATION", "CREATED"]} minWidth={760}>
            {execs.data.data.length === 0 ? <Empty title="No runs yet" text="This agent has not reported anything. The Connect tab has the code." /> : execs.data.data.map((e: any) => (
              <A key={e.id} href={`/executions/${e.id}`} css={rowCss(COLS, 50)} hover="background:#151917;color:#E8ECE9">
                <Mono>{short(e.id, 10, 4)}</Mono>
                <span style={s("font-size:13.5px;color:#9BA39E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{e.taskDescription}</span>
                <span><Pill b={executionBadge(e.status)} /></span><span><Pill b={validationBadge(e.validationStatus)} /></span>
                <Mono color="#7C847F" size={12}>{ago(e.createdAt)}</Mono>
              </A>
            ))}
          </Table>
        )
      )}

      {tab === "connect" && (
        <Card gap={16} pad={24}>
          <span style={s("font-size:14px;color:#9BA39E;line-height:1.65;max-width:760px")}>
            This is all it takes for <b style={{ color: "#E8ECE9", fontWeight: 500 }}>{a.name}</b> to start reporting. Wrap the work your agent already does; Verid records the calls as evidence, validates the result on its server, and watches this agent’s health.
          </span>
          <ConnectAgent slug={a.slug} />
        </Card>
      )}

      {tab === "settings" && <Settings a={a} canWrite={canWrite} onChanged={agent.reload} onDeleted={() => { toast("Agent deleted"); router.push("/agents"); }} />}

      {tab === "identity" && (
        <Card gap={14}>
          <KV rows={[
            ["Agent ID", <Mono key="i">{a.id}</Mono>],
            ["Version", <Mono key="v">{a.version}</Mono>],
            ["Registered", <Mono key="r">{fmtDateTime(a.createdAt)}</Mono>],
            ["Identity reference", a.identityReference ? <Mono key="x">{a.identityReference}</Mono> : <span style={{ color: "#7C847F" }}>None recorded</span>],
          ]} />
          <div style={s("padding:12px 14px;border:1px solid #252B27;border-radius:8px;background:#0F1210;font-size:13px;color:#9BA39E;line-height:1.55")}>
            {a.identityReference
              ? "This reference is recorded as supplied. Verid has NOT verified it, so it does not establish a cryptographic identity."
              : "No external identity (e.g. ERC-8004) is linked. This agent record is a Verid-internal label only."}
          </div>
        </Card>
      )}
    </Page>
  );
}

function Settings({ a, canWrite, onChanged, onDeleted }: { a: any; canWrite: boolean; onChanged: () => void; onDeleted: () => void }) {
  const { toast } = useSession();
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description ?? "");
  const [version, setVersion] = useState(a.version);
  const [caps, setCaps] = useState((a.capabilities ?? []).join(", "));
  const [busy, setBusy] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const archived = a.status === "inactive";
  const dirty = name !== a.name || description !== (a.description ?? "") || version !== a.version || caps !== (a.capabilities ?? []).join(", ");

  const save = async () => {
    setBusy("save");
    setError("");
    try {
      await patch(`/agents/${a.id}`, { name: name.trim(), description: description.trim(), version: version.trim(), capabilities: caps.split(",").map((c: string) => c.trim()).filter(Boolean) });
      toast("Saved");
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
  const archive = async () => {
    setBusy("archive");
    try {
      await patch(`/agents/${a.id}`, { status: archived ? "active" : "inactive" });
      toast(archived ? "Agent reactivated" : "Agent archived");
      onChanged();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await del(`/agents/${a.id}`);
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : errorMessage(e));
      setConfirmDelete(false);
      setBusy("");
    }
  };
  const lbl = (t: string) => <span style={s("font-size:12.5px;color:#9BA39E")}>{t}</span>;
  const hasRuns = a.executions > 0;

  return (
    <div style={s("display:flex;flex-direction:column;gap:16px")}>
      <Card gap={14}>
        <Label>DETAILS</Label>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:14px")}>
          <label style={s("display:flex;flex-direction:column;gap:6px")}>{lbl("Name")}<Field value={name} disabled={!canWrite} onChange={(e) => setName(e.target.value)} css={inputCss} /></label>
          <label style={s("display:flex;flex-direction:column;gap:6px")}>{lbl("Version")}<Field value={version} disabled={!canWrite} onChange={(e) => setVersion(e.target.value)} css={inputCss} /></label>
          <label style={s("display:flex;flex-direction:column;gap:6px;grid-column:1 / -1")}>{lbl("Capabilities (comma-separated)")}<Field value={caps} disabled={!canWrite} onChange={(e) => setCaps(e.target.value)} css={inputCss} /></label>
          <label style={s("display:flex;flex-direction:column;gap:6px;grid-column:1 / -1")}>{lbl("Description")}<Area value={description} disabled={!canWrite} onChange={(e) => setDescription(e.target.value)} css={inputCss + ";height:64px;padding:10px 12px;resize:vertical;font-family:inherit"} /></label>
        </div>
        <span style={s("font-size:12px;color:#7C847F")}>The handle <Mono size={12}>{a.slug}</Mono> cannot change: your code refers to the agent by it, and past runs are recorded under it.</span>
        {canWrite && <div><Btn onClick={save} disabled={!dirty || busy !== ""} css={primaryBtn} hover={primaryHover}>{busy === "save" ? <Spinner /> : null} Save changes</Btn></div>}
      </Card>

      {canWrite && (
        <Card gap={16}>
          <Label>ARCHIVE OR DELETE</Label>
          <div style={s("display:flex;flex-direction:column;gap:6px")}>
            <span style={s("font-size:14px;font-weight:500")}>{archived ? "Reactivate" : "Archive"} this agent</span>
            <span style={s("font-size:13px;color:#9BA39E;line-height:1.55;max-width:680px")}>
              {archived ? "It will show as active again." : "Keeps every run, receipt and anchor exactly as they are, and hides the agent from the active list. Use this for an agent you no longer run."}
            </span>
            <div><Btn onClick={archive} disabled={busy !== ""} css={ghostBtn} hover={ghostHover}>{busy === "archive" ? <Spinner /> : null} {archived ? "Reactivate" : "Archive"}</Btn></div>
          </div>
          <div style={s("height:1px;background:#1D221F")} />
          <div style={s("display:flex;flex-direction:column;gap:6px")}>
            <span style={s("font-size:14px;font-weight:500;color:#D08A8A")}>Delete this agent</span>
            {hasRuns ? (
              <span style={s("font-size:13px;color:#9BA39E;line-height:1.55;max-width:680px")}>
                This agent has {a.executions} recorded run{a.executions === 1 ? "" : "s"}. Those are a permanent record other people may be relying on (receipts, anchors, escrows), so it cannot be deleted. Archive it instead.
              </span>
            ) : confirmDelete ? (
              <div style={s("display:flex;gap:8px;align-items:center;flex-wrap:wrap")}>
                <span style={s("font-size:13px;color:#D08A8A")}>Delete “{a.name}” for good? It has never run.</span>
                <Btn onClick={remove} disabled={busy !== ""} css="height:32px;padding:0 14px;border-radius:8px;border:1px solid rgba(166,93,93,0.5);background:rgba(166,93,93,0.12);color:#D08A8A;font-size:13px;cursor:pointer" hover="background:rgba(166,93,93,0.2)">{busy === "delete" ? "Deleting…" : "Yes, delete"}</Btn>
                <Btn onClick={() => setConfirmDelete(false)} css={ghostBtn} hover={ghostHover}>Keep it</Btn>
              </div>
            ) : (
              <>
                <span style={s("font-size:13px;color:#9BA39E;line-height:1.55;max-width:680px")}>This agent has never run, so deleting it loses nothing.</span>
                <div><Btn onClick={() => setConfirmDelete(true)} css="height:36px;padding:0 14px;border-radius:8px;border:1px solid rgba(166,93,93,0.4);background:transparent;color:#D08A8A;font-size:13px;cursor:pointer" hover="background:rgba(166,93,93,0.1)">Delete agent…</Btn></div>
              </>
            )}
          </div>
          {error && <span role="alert" style={s("font-size:12.5px;color:#D08A8A")}>{error}</span>}
        </Card>
      )}
    </div>
  );
}
