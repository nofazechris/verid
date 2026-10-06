"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Empty, ErrorBox, Label, Loading, Mono, Page, Pill, Spinner, ghostBtn, ghostHover, primaryBtn, primaryHover, MONO } from "@/components/kit";
import VerificationReport, { type Report } from "@/components/VerificationReport";
import { errorMessage, get, post } from "@/lib/client/api";
import { anchorBadge, downloadJson, explorerTxUrl, fmtDateTime, short, validationBadge } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

const cell = "padding:14px 0;border-bottom:1px solid #1D221F";
const mono = `font-family:${MONO};font-size:12.5px;overflow-wrap:anywhere`;

/** Assemble the verification bundle from this workspace's real records (task, policy, evidence commitments, result, validation). */
async function buildBundle(executionId: string) {
  const [{ execution: ex }, { data: ev }] = await Promise.all([
    get<{ execution: any }>(`/executions/${executionId}`),
    get<{ data: any[] }>(`/executions/${executionId}/evidence`),
  ]);
  const policy = ex.policy ? (await get<{ policy: any }>(`/policies/${ex.policy.id}`)).policy.definition : undefined;
  return {
    task: ex.taskDefinition,
    ...(policy ? { policy } : {}),
    evidence: ev.map((e) => ({ executionId, sequenceNumber: e.sequenceNumber, type: e.type, timestamp: e.evidenceTimestamp, contentHash: e.contentHash })),
    result: ex.result,
    validation: ex.validation?.result,
  };
}

export default function ReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useSession();
  const canWrite = useCan("developer");
  const [live, setLive] = useState(false);
  const r = useApi<{ receipt: any; anchor: any; executionId: string }>(`/receipts/${id}`, { pollMs: live ? 3000 : undefined });
  const ex = useApi<{ execution: any }>(r.data ? `/executions/${r.data.executionId}` : null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState("");

  if (r.loading && !r.data) return <Page><Loading /></Page>;
  if (r.error && !r.data) {
    const nf = (r.error as { status?: number }).status === 404;
    return <Page>{nf ? <Empty title="Receipt not found" text="It may belong to another workspace or no longer exist." action={<A href="/receipts" css="color:#4ADE80;font-size:13.5px">Back to receipts</A>} /> : <ErrorBox error={r.error} retry={r.reload} />}</Page>;
  }
  const { receipt, anchor, executionId } = r.data!;
  const status = ex.data?.execution.status as string | undefined;
  const pending = status === "anchoring";
  if (live !== pending) setLive(pending);
  const canAnchor = canWrite && status === "validated";
  const link = explorerTxUrl(receipt.anchor?.transactionHash ?? anchor?.transactionHash);

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
  const doVerify = () => act("verify", async () => {
    const bundle = await buildBundle(executionId);
    setReport(await post<Report>("/receipts/verify", { receipt, bundle }));
  });
  const doAnchor = () => act("anchor", async () => {
    const res = await post<any>(`/receipts/${id}/anchor`);
    toast(res.anchor?.status === "confirmed" ? "Anchored on Arc" : "Anchor submitted — waiting for confirmation");
    r.reload();
    ex.reload();
  });
  const exportBundle = () => act("bundle", async () => downloadJson(`bundle_${executionId}.json`, await buildBundle(executionId)));
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/proof/${id}` : `/proof/${id}`;

  return (
    <Page>
      <div style={s("display:flex;justify-content:center;padding:8px 0 0")}>
        <div style={s("width:100%;max-width:780px;display:flex;flex-direction:column;gap:20px")}>
          <div style={s("position:relative;border:1px solid #303832;border-radius:16px;background:#101311;overflow:hidden;box-shadow:0 40px 120px -60px rgba(0,0,0,0.8)")}>
            <div style={s("position:absolute;inset:0;background-image:linear-gradient(#141816 1px,transparent 1px),linear-gradient(90deg,#141816 1px,transparent 1px);background-size:24px 24px;opacity:0.5;pointer-events:none")} />
            <div style={s("position:relative;padding:36px 44px 28px;display:flex;align-items:flex-start;gap:16px;border-bottom:1px dashed #303832;flex-wrap:wrap")}>
              <div style={s("display:flex;flex-direction:column;gap:12px;min-width:0")}>
                <span style={s(`font-family:${MONO};font-size:12px;letter-spacing:0.14em;color:#9BA39E`)}>EXECUTION RECEIPT</span>
                <span style={s(`font-size:22px;font-weight:600;letter-spacing:-0.01em;font-family:${MONO};overflow-wrap:anywhere`)}>{receipt.receiptId}</span>
              </div>
              <div style={s("margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:8px")}>
                <Pill large b={validationBadge(receipt.validation.status)} />
                <Pill large b={anchorBadge(receipt.anchor ? "confirmed" : anchor?.status)} />
              </div>
            </div>

            <div style={s("position:relative;padding:8px 44px")}>
              <div style={s("display:grid;grid-template-columns:150px minmax(0,1fr);font-size:13.5px")}>
                <span style={s(cell + ";color:#7C847F")}>Agent</span><span style={s(cell)}>{receipt.agent.id} <span style={s(mono + ";color:#9BA39E")}>v{receipt.agent.version}</span></span>
                <span style={s(cell + ";color:#7C847F")}>Execution</span><span style={s(cell)}><A href={`/executions/${executionId}`} css={mono + ";color:#E8ECE9"}>{executionId}</A></span>
                <span style={s(cell + ";color:#7C847F")}>Task commitment</span><span style={s(cell + ";" + mono)}>{receipt.task.hash}</span>
                <span style={s(cell + ";color:#7C847F")}>Policy commitment</span><span style={s(cell + ";" + mono)}>{receipt.policy ? `${receipt.policy.id} · ${receipt.policy.hash}` : "none"}</span>
                <span style={s(cell + ";color:#7C847F")}>Evidence root</span><span style={s(cell + ";" + mono)}>{receipt.evidence.root} <span style={{ color: "#7C847F" }}>({receipt.evidence.count} records)</span></span>
                <span style={s(cell + ";color:#7C847F")}>Result commitment</span><span style={s(cell + ";" + mono)}>{receipt.result.hash}</span>
                <span style={s(cell + ";color:#7C847F")}>Validation</span><span style={s(cell + ";" + mono)}>{receipt.validation.status.toUpperCase()} · {receipt.validation.validatorId}@{receipt.validation.validatorVersion}</span>
                <span style={s("padding:14px 0;color:#7C847F")}>Arc anchor</span>
                <span style={s("padding:14px 0;" + mono)}>
                  {receipt.anchor ? <>block #{receipt.anchor.blockNumber?.toLocaleString("en-US") ?? "—"} · tx {receipt.anchor.transactionHash}{link && <> · <a href={link} target="_blank" rel="noreferrer" style={{ color: "#4ADE80" }}>explorer ↗</a></>}</> : anchor?.status === "submitted" ? "submitted, awaiting confirmation" : "not anchored"}
                </span>
              </div>
            </div>

            <div style={s("position:relative;padding:18px 44px 24px;border-top:1px dashed #303832;display:flex;gap:12px;align-items:center;flex-wrap:wrap")}>
              <span style={s("font-size:13px;font-weight:500")}>Cryptographic commitments</span>
              <span style={s(`margin-left:auto;font-family:${MONO};font-size:11.5px;color:#7C847F;overflow-wrap:anywhere`)}>receipt hash {short(receipt.receiptHash, 10, 6)} · created {fmtDateTime(receipt.timestamps?.createdAt)}</span>
            </div>
          </div>

          <div style={s("display:flex;gap:8px;flex-wrap:wrap")}>
            <Btn onClick={doVerify} disabled={busy === "verify" || !ex.data} css={primaryBtn} hover={primaryHover}>{busy === "verify" ? <Spinner /> : null} Verify now</Btn>
            {canAnchor && <Btn onClick={doAnchor} disabled={busy === "anchor"} css={ghostBtn} hover={ghostHover}>{busy === "anchor" ? <Spinner /> : null} Anchor on Arc</Btn>}
            {pending && <span style={s("display:flex;align-items:center;gap:8px;font-size:13px;color:#CDB274")}><Spinner size={12} /> Waiting for confirmation…</span>}
            <Btn onClick={() => downloadJson(`receipt_${id}.json`, receipt)} css={ghostBtn} hover={ghostHover}>Export receipt JSON</Btn>
            <Btn onClick={exportBundle} disabled={busy === "bundle"} css={ghostBtn} hover={ghostHover}>Export verification bundle</Btn>
            <Btn onClick={() => { void navigator.clipboard?.writeText(publicUrl); toast("Public link copied"); }} css={ghostBtn} hover={ghostHover}>Copy public link</Btn>
          </div>

          {report && <VerificationReport report={report} />}

          <div style={s("border:1px solid #252B27;border-radius:12px;background:#0F1210;padding:18px 20px;display:flex;flex-direction:column;gap:10px")}>
            <Label>VERIFY INDEPENDENTLY (DOES NOT TRUST THIS DASHBOARD)</Label>
            <pre style={s(`margin:0;font-family:${MONO};font-size:12px;line-height:1.7;color:#C8D0CB;overflow-x:auto`)}>{`verid receipt verify receipt_${id}.json \\\n  --bundle bundle_${executionId}.json \\\n  --rpc $ARC_RPC_URL --registry $VERID_REGISTRY_ADDRESS`}</pre>
            <span style={s("font-size:12px;color:#7C847F;line-height:1.55")}>The bundle contains your task and result so the commitments can be recomputed; share it deliberately. “Verify now” above runs on the Verid server; the CLI checks the chain directly.</span>
          </div>
        </div>
      </div>
    </Page>
  );
}
