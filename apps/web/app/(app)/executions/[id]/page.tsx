"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import SettlementPanel from "@/components/SettlementPanel";
import { Card, Empty, ErrorBox, KV, Label, Loading, Mono, Page, Pill, Spinner, ghostBtn, ghostHover, primaryBtn, primaryHover, MONO } from "@/components/kit";
import { errorMessage, post } from "@/lib/client/api";
import { anchorBadge, executionBadge, explorerTxUrl, fmtDateTime, short, validationBadge } from "@/lib/client/format";
import { NODE_KEYS, NODE_LABEL, deriveNodes, nodeStyle, type NodeKey, type NodeState } from "@/lib/client/graph";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

const LIVE = new Set(["running", "evidence_captured", "awaiting_validation", "anchoring"]);

function Copyable({ value, label }: { value: string; label?: string }) {
  const { toast } = useSession();
  return (
    <Btn onClick={() => { void navigator.clipboard?.writeText(value); toast("Copied"); }} css="background:transparent;border:0;padding:0;cursor:pointer;display:inline-flex;gap:8px;align-items:center;text-align:right" hover="opacity:.8">
      <Mono>{label ?? short(value)}</Mono><span style={s("font-size:11px;color:#6B736E")}>Copy</span>
    </Btn>
  );
}

function Drawer({ open, onClose, kicker, title, badge, children }: { open: boolean; onClose: () => void; kicker: string; title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div style={s(`position:fixed;inset:0;z-index:40;pointer-events:${open ? "auto" : "none"}`)}>
      <div onClick={onClose} style={s(`position:absolute;inset:0;background:rgba(5,6,6,0.55);opacity:${open ? 1 : 0};transition:opacity .25s ease`)} />
      <aside aria-hidden={!open} style={s(`position:absolute;top:0;right:0;bottom:0;width:min(480px,100vw);background:#121513;border-left:1px solid #252B27;box-shadow:-24px 0 80px rgba(0,0,0,0.5);transform:translateX(${open ? 0 : 102}%);transition:transform .32s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;overflow-y:auto`)}>
        <div style={s("display:flex;align-items:flex-start;gap:12px;padding:24px 24px 20px;border-bottom:1px solid #1D221F")}>
          <div style={s("display:flex;flex-direction:column;gap:8px;min-width:0")}>
            <Label>{kicker}</Label>
            <span style={s("font-size:20px;font-weight:500;letter-spacing:-0.015em;overflow-wrap:anywhere")}>{title}</span>
            {badge}
          </div>
          <Btn onClick={onClose} aria-label="Close" css="margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid #252B27;background:transparent;color:#9BA39E;cursor:pointer;font-size:16px;flex:none" hover="background:#1D221F;color:#E8ECE9">×</Btn>
        </div>
        <div style={s("padding:20px 24px 32px;display:flex;flex-direction:column;gap:20px")}>{children}</div>
      </aside>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div style={s("display:flex;justify-content:space-between;align-items:center;gap:16px;padding:11px 0;border-bottom:1px solid #1D221F")}>
    <span style={s("font-size:13px;color:#7C847F;min-width:0")}>{k}</span>
    <span style={s("text-align:right;max-width:70%;overflow:hidden;text-overflow:ellipsis")}>{v}</span>
  </div>
);
const Note = ({ children }: { children: ReactNode }) => (
  <p style={s("margin:0;font-size:13px;color:#9BA39E;padding:12px 14px;border:1px solid #252B27;border-radius:8px;background:#0F1210;line-height:1.55")}>{children}</p>
);

function Panel({ k, ex, ev }: { k: NodeKey; ex: any; ev: any[] }) {
  const v = ex.validation;
  const evList = (types: string[]) => ev.filter((e) => types.includes(e.type));
  const evRows = (list: any[]) => list.length ? list.map((e) => <Row key={e.id} k={`#${e.sequenceNumber} · ${e.type}`} v={<Copyable value={e.contentHash} />} />) : <Note>None recorded.</Note>;
  switch (k) {
    case "task": return <><Note>“{ex.taskDefinition.description}”</Note><Row k="Task hash" v={<Copyable value={ex.taskHash} />} /><Row k="Created" v={<Mono>{fmtDateTime(ex.createdAt)}</Mono>} />{ex.taskDefinition.parameters && <Row k="Parameters" v={<Mono>{JSON.stringify(ex.taskDefinition.parameters)}</Mono>} />}</>;
    case "policy": return ex.policy ? <><Row k="Policy" v={<Mono>{ex.policy.slug} · v{ex.policy.version}</Mono>} /><Row k="Policy hash" v={<Copyable value={ex.policy.policyHash} />} /><Note>The policy hash records WHICH rules governed this run. It does not prove the agent obeyed them; that requires evidence or enforcement appropriate to each rule.</Note></> : <Note>No policy was bound to this execution.</Note>;
    case "agent": return <><Row k="Agent" v={<A href={`/agents/${ex.agent.id}`} css="color:#E8ECE9">{ex.agent.name}</A>} /><Row k="Handle" v={<Mono>{ex.agent.slug}</Mono>} /><Row k="Version" v={<Mono>{ex.agent.version}</Mono>} /></>;
    case "call": return <>{evRows(evList(["tool_call"]))}</>;
    case "result": return <>{evRows(evList(["tool_result"]))}</>;
    case "evidence": return (
      <>
        <Row k="Evidence root" v={ex.evidenceRoot ? <Copyable value={ex.evidenceRoot} /> : <Mono color="#7C847F">uncommitted</Mono>} />
        <Row k="Records" v={<Mono>{ex.evidenceCount ?? ev.length}</Mono>} />
        <Row k="Result hash" v={ex.resultHash ? <Copyable value={ex.resultHash} /> : <Mono color="#7C847F">—</Mono>} />
        {evRows(ev)}
        <Note>The root commits each record’s type, order, timestamp, execution and content hash, plus the record count. Raw content stays off-chain, and record <i>metadata</i> is not committed.</Note>
      </>
    );
    case "validator": return v ? (
      <>
        <Row k="Validator" v={<Mono>{v.validatorId}@{v.validatorVersion}</Mono>} />
        <Row k="Outcome" v={<Pill b={validationBadge(v.status)} />} />
        <Row k="Result hash" v={<Copyable value={v.resultHash} />} />
        <div style={s("display:flex;flex-direction:column;border:1px solid #252B27;border-radius:10px;padding:6px 14px;background:#0F1210")}>
          {(v.checks as any[]).map((c) => (
            <div key={c.id} style={s("display:flex;flex-direction:column;gap:2px;padding:9px 0;border-bottom:1px solid #161A18")}>
              <div style={s("display:flex;align-items:center;gap:10px")}>
                <span style={s(`font-family:${MONO};color:${!c.determinate ? "#CDB274" : c.ok ? "#4ADE80" : "#D08A8A"};width:14px`)}>{!c.determinate ? "◷" : c.ok ? "✓" : "✕"}</span>
                <span style={s("font-size:13px;color:#C8D0CB")}>{c.description}</span>
              </div>
              {c.explanation && !c.ok && <span style={s(`font-family:${MONO};font-size:11.5px;color:#D08A8A;padding-left:24px`)}>{c.explanation}</span>}
            </div>
          ))}
        </div>
        <Note>A validation result means this validator returned this outcome under its published rules. It does not prove the data is factually true or that the validator is independent. Items marked ◷ were not evaluated.</Note>
      </>
    ) : <Note>No validation has run yet.</Note>;
    case "settlement": return ex.settlement ? (
      <>
        <Row k="Status" v={<Mono>{ex.settlement.status}</Mono>} />
        <Row k="Payee" v={<Copyable value={ex.settlement.recipientAddress} />} />
        <Row k="Payer" v={<Copyable value={ex.settlement.requesterAddress} />} />
        {ex.settlement.releaseTxHash && <Row k="Release transaction" v={<Copyable value={ex.settlement.releaseTxHash} />} />}
        {ex.settlement.refundTxHash && <Row k="Refund transaction" v={<Copyable value={ex.settlement.refundTxHash} />} />}
        <Note>Funds move only after the validator recorded a Pass on-chain and the receipt is anchored. Details and actions are in the settlement panel on this page.</Note>
      </>
    ) : <Note>No escrow is linked to this execution. Fund one from the settlement panel on this page.</Note>;
    case "arc": {
      const a = ex.anchor;
      if (!a) return <Note>{v && v.status !== "pass" ? "This execution failed validation, so it cannot be anchored. The failed record is preserved." : "Not anchored. Anchor a validated receipt from the receipt page or the panel below."}</Note>;
      const link = explorerTxUrl(a.transactionHash);
      return (
        <>
          <Row k="Status" v={<Pill b={anchorBadge(a.status)} />} />
          <Row k="Network" v={<Mono>{a.network} · chain {a.chainId}</Mono>} />
          <Row k="Registry" v={<Copyable value={a.contractAddress} />} />
          <Row k="Transaction" v={a.transactionHash ? <Copyable value={a.transactionHash} /> : <Mono color="#7C847F">not yet submitted</Mono>} />
          <Row k="Block" v={<Mono>{a.blockNumber ? `#${a.blockNumber.toLocaleString("en-US")}` : "—"}</Mono>} />
          {link && <a href={link} target="_blank" rel="noreferrer" style={{ color: "#4ADE80", fontSize: 13 }}>Open in explorer ↗</a>}
          {a.status !== "confirmed" && <Note>A submitted transaction is not confirmed until it is mined. This page reflects the chain, not the submission.</Note>}
        </>
      );
    }
  }
}

export default function ExecutionDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useSession();
  const canWrite = useCan("developer");
  const [live, setLive] = useState(false);
  const ex = useApi<{ execution: any }>(`/executions/${id}`, { pollMs: live ? 3000 : undefined });
  const evq = useApi<{ data: any[] }>(`/executions/${id}/evidence`, { pollMs: live ? 3000 : undefined });
  const [open, setOpen] = useState<NodeKey | null>(null);
  const [progress, setProgress] = useState(9);
  const [busy, setBusy] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const e = ex.data?.execution;
  useEffect(() => setLive(!!e && LIVE.has(e.status)), [e]);
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(null);
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  if (ex.loading && !e) return <Page><Loading /></Page>;
  if (ex.error && !e) {
    const nf = (ex.error as { status?: number }).status === 404;
    return <Page>{nf ? <Empty title="Execution not found" text="No execution with this ID exists in this workspace." action={<A href="/executions" css="color:#4ADE80;font-size:13.5px">Back to executions</A>} /> : <ErrorBox error={ex.error} retry={ex.reload} />}</Page>;
  }
  const ev = evq.data?.data ?? [];
  const nodes = deriveNodes(e, ev);
  const vstatus = e.validation?.status as string | undefined;
  const failedChecks = (e.validation?.checks as any[] | undefined)?.filter((c) => c.determinate && !c.ok) ?? [];

  const replay = () => {
    clearInterval(timer.current);
    setProgress(0);
    let p = 0;
    timer.current = setInterval(() => {
      p++;
      setProgress(p);
      if (p >= 9) clearInterval(timer.current);
    }, 360);
  };
  const stateAt = (i: number, st: NodeState): NodeState => (i < progress ? st : "idle");
  let last = 0;
  nodes.forEach((n, i) => { if (stateAt(i, n.state) !== "idle") last = i; });

  const act = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    try {
      await fn();
      toast(ok);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy("");
      ex.reload();
    }
  };
  const createReceipt = () => act("receipt", () => post("/receipts", { executionId: id }), "Receipt generated");
  const anchor = () => act("anchor", async () => {
    const r = await post<any>(`/receipts/${e.receipt.id}/anchor`);
    if (r?.anchor?.status !== "confirmed") toast("Anchor submitted — waiting for confirmation");
  }, "Anchored on Arc");

  const hdr = executionBadge(e.status);
  const sel = open ? nodes.find((n) => n.key === open) : null;

  return (
    <>
      <Page>
        <div style={s("display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap")}>
          <div style={s("display:flex;flex-direction:column;gap:10px;min-width:0")}>
            <div style={s("display:flex;align-items:center;gap:14px;flex-wrap:wrap")}>
              <h1 style={s(`margin:0;font-size:26px;letter-spacing:-0.02em;font-weight:600;font-family:${MONO}`)}>{short(e.id, 12, 6)}</h1>
              <Pill large b={hdr} />
              {vstatus && <Pill large b={validationBadge(vstatus)} />}
            </div>
            <div style={s("display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:#9BA39E")}>
              <span>Agent <A href={`/agents/${e.agent.id}`} css="color:#E8ECE9">{e.agent.name}</A> <Mono color="#7C847F" size={12}>v{e.agent.version}</Mono></span>
              {e.policy && <span>Policy <Mono size={12}>{e.policy.slug} v{e.policy.version}</Mono></span>}
              <span>Created <Mono size={12}>{fmtDateTime(e.createdAt)}</Mono></span>
            </div>
            <p style={s("margin:4px 0 0;font-size:15px;color:#C8D0CB;max-width:720px")}>“{e.taskDefinition.description}”</p>
          </div>
          <div style={s("margin-left:auto;display:flex;gap:8px;flex:none;flex-wrap:wrap")}>
            <Btn onClick={replay} css={ghostBtn} hover={ghostHover}>Replay</Btn>
            <Btn onClick={() => { void navigator.clipboard?.writeText(e.id); toast("Execution ID copied"); }} css={ghostBtn} hover={ghostHover}>Copy ID</Btn>
            {e.receipt ? <A href={`/receipts/${e.receipt.id}`} css={primaryBtn + ";display:inline-flex;align-items:center;text-decoration:none;color:#0B0D0C"} hover={primaryHover}>View receipt</A>
              : canWrite && e.validation ? <Btn onClick={createReceipt} disabled={busy === "receipt"} css={primaryBtn} hover={primaryHover}>{busy === "receipt" ? <Spinner /> : null} Generate receipt</Btn> : null}
          </div>
        </div>

        <div style={s("border:1px solid #252B27;border-radius:14px;background:#101311;overflow:hidden")}>
          <div style={s("display:flex;align-items:center;gap:20px;padding:16px 24px;border-bottom:1px solid #1D221F;flex-wrap:wrap")}>
            <Label>EXECUTION GRAPH</Label>
            <div style={s("display:flex;gap:16px;font-size:12px;color:#9BA39E;flex-wrap:wrap")}>
              <span><span style={{ color: "#4ADE80" }}>✓</span> Recorded</span><span><span style={{ color: "#CDB274" }}>◷</span> Awaiting</span><span><span style={{ color: "#D08A8A" }}>✕</span> Failed</span>
              <span><span style={s("display:inline-block;width:8px;height:8px;border-radius:50%;border:1px solid #3A443D;margin-right:6px")} />Not present</span>
            </div>
            <span style={s("margin-left:auto;font-size:12px;color:#7C847F")}>Select any stage to inspect</span>
          </div>
          <div style={s("padding:40px 24px 36px;overflow-x:auto")}>
            <div style={s("position:relative;display:grid;grid-template-columns:repeat(9,minmax(104px,1fr));min-width:960px")}>
              <div style={s("position:absolute;top:24px;left:calc(100% / 18);right:calc(100% / 18);height:1px;background:#252B27")}>
                <div style={s(`height:1px;width:${(last / 8) * 100}%;background:#2C8A66;transition:width .36s linear`)} />
              </div>
              {nodes.map((n, i) => {
                const st = stateAt(i, n.state);
                const v = nodeStyle(st, n.key, { selected: open === n.key });
                return (
                  <Btn key={n.key} onClick={() => setOpen(n.key)} css="position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;background:transparent;border:0;padding:0 4px;cursor:pointer;color:inherit;text-align:center" hover="transform:translateY(-1px)">
                    <span style={s(`position:relative;width:48px;height:48px;border-radius:${v.rad};border:1px solid ${v.bd};background:${v.bg};color:${v.fg};display:grid;place-items:center;flex:none;box-shadow:${v.glow};animation:${v.anim};outline:${v.ring};outline-offset:4px;transition:border-color .3s ease, background .3s ease, color .3s ease`)}>
                      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={v.icon} /></svg>
                      <span style={s(`position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:50%;background:${v.cb};border:1px solid ${v.cbd};color:${v.cfg};font-family:${MONO};font-size:9px;line-height:1;display:grid;place-items:center;opacity:${v.cop};transform:scale(${v.csc});transition:opacity .25s ease, transform .25s ease`)}>{v.glyph}</span>
                    </span>
                    <span style={s(`font-family:${MONO};font-size:11px;letter-spacing:0.1em;color:${v.lc};margin-top:4px`)}>{NODE_LABEL[n.key]}</span>
                    <span style={s(`font-family:${MONO};font-size:11px;color:#9BA39E`)}>{st === "idle" && i >= progress ? "—" : n.sub}</span>
                  </Btn>
                );
              })}
            </div>
          </div>
        </div>

        {(vstatus === "fail" || vstatus === "inconclusive") && (
          <div style={s("border:1px solid rgba(166,93,93,0.35);border-radius:12px;background:#140F0F;padding:24px;display:flex;flex-direction:column;gap:14px;animation:apFade .35s ease both")}>
            <div style={s("display:flex;align-items:center;gap:10px")}><span style={s(`color:#D08A8A;font-family:${MONO}`)}>✕</span><h2 style={s("margin:0;font-size:18px;font-weight:500")}>Validation {vstatus === "fail" ? "failed" : "was inconclusive"}</h2></div>
            <p style={s("margin:0;color:#9BA39E;font-size:13.5px")}>This record is preserved and cannot be changed or anchored. To try again, create a new execution; it will get its own receipt.</p>
            {failedChecks.map((c) => (
              <div key={c.id} style={s("display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid rgba(166,93,93,0.25);border-radius:8px")}>
                <span style={s("font-size:13px")}>{c.description}</span>
                <span style={s(`font-family:${MONO};font-size:12px;color:#D08A8A`)}>{c.explanation}</span>
              </div>
            ))}
            <div><Btn onClick={() => setOpen("validator")} css={ghostBtn} hover="background:#1A1616">Inspect validation</Btn></div>
          </div>
        )}

        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px")}>
          <Btn onClick={() => setOpen("evidence")} css="text-align:left;border:1px solid #252B27;border-radius:12px;background:#101311;padding:22px;display:flex;flex-direction:column;gap:14px;cursor:pointer;color:inherit;transition:border-color .15s ease, background .15s ease" hover="border-color:#303832;background:#131714">
            <Label>EVIDENCE</Label>
            <Mono size={15}>{e.evidenceRoot ? short(e.evidenceRoot) : "uncommitted"}</Mono>
            <span style={s("font-size:12.5px;color:#9BA39E")}><Mono size={12.5}>{e.evidenceCount ?? ev.length}</Mono> records</span>
          </Btn>
          <Btn onClick={() => setOpen("validator")} css="text-align:left;border:1px solid #252B27;border-radius:12px;background:#101311;padding:22px;display:flex;flex-direction:column;gap:14px;cursor:pointer;color:inherit;transition:border-color .15s ease, background .15s ease" hover="border-color:#303832;background:#131714">
            <Label>VALIDATION</Label>
            <span><Pill b={validationBadge(vstatus)} /></span>
            <span style={s("font-size:12.5px;color:#9BA39E")}>{e.validation ? `${e.validation.validatorId}@${e.validation.validatorVersion}` : "not yet run"}</span>
          </Btn>
          <Card gap={14}>
            <Label>ARC ANCHOR</Label>
            {e.anchor?.status === "confirmed" ? <><Pill b={anchorBadge("confirmed")} /><Mono size={13}>{short(e.anchor?.transactionHash)}</Mono></>
              : e.status === "anchoring" ? <><Pill b={anchorBadge("submitted")} /><span style={s("font-size:12.5px;color:#9BA39E;display:flex;gap:8px;align-items:center")}><Spinner size={12} /> Waiting for confirmation…</span></>
              : e.status === "validated" && e.receipt && canWrite ? <><span style={s("font-size:12.5px;color:#9BA39E")}>Validated and ready to anchor.</span><Btn onClick={anchor} disabled={busy === "anchor"} css={primaryBtn} hover={primaryHover}>{busy === "anchor" ? <Spinner /> : null} Anchor on Arc</Btn></>
              : e.status === "validated" ? <span style={s("font-size:12.5px;color:#9BA39E")}>Generate a receipt, then anchor it.</span>
              : <span style={s("font-size:12.5px;color:#7C847F")}>{vstatus && vstatus !== "pass" ? "Not anchorable: validation did not pass." : "Available after validation passes."}</span>}
          </Card>
        </div>

        <SettlementPanel executionId={e.id} executionStatus={e.status} onChange={ex.reload} />

        <div>
          <div style={s("margin-bottom:12px")}><Label>EVIDENCE TIMELINE</Label></div>
          <div style={s("border:1px solid #252B27;border-radius:12px;background:#101311;overflow:hidden")}>
            {ev.length === 0 ? <div style={s("padding:20px;font-size:13px;color:#7C847F")}>No evidence recorded yet.</div> : ev.map((r) => (
              <div key={r.id} style={s("display:grid;grid-template-columns:48px 130px minmax(0,1fr) 210px;gap:16px;align-items:center;min-height:44px;padding:0 20px;border-bottom:1px solid #161A18")}>
                <Mono color="#7C847F">#{r.sequenceNumber}</Mono><Mono>{r.type}</Mono><Mono color="#9BA39E">{short(r.contentHash, 10, 6)}</Mono><Mono color="#7C847F" size={12}>{fmtDateTime(r.evidenceTimestamp)}</Mono>
              </div>
            ))}
          </div>
          <p style={s("margin:10px 0 0;font-size:12px;color:#7C847F")}>Hashes are commitments to content that stays off-chain. Timestamps are assigned by the Verid server.</p>
        </div>
      </Page>

      <Drawer open={!!open} onClose={() => setOpen(null)} kicker={sel ? `${NODE_KEYS.indexOf(sel.key) + 1} · ${NODE_LABEL[sel.key]}` : ""} title={sel ? NODE_LABEL[sel.key].charAt(0) + NODE_LABEL[sel.key].slice(1).toLowerCase() : ""}>
        {sel && <Panel k={sel.key} ex={e} ev={ev} />}
      </Drawer>
    </>
  );
}
