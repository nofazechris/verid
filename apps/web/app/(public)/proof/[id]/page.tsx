"use client";

import { useParams } from "next/navigation";
import { s } from "@/lib/style";
import { A } from "@/components/ui";
import { Card, Empty, ErrorBox, KV, Label, Loading, Mono, Page, Pill, MONO } from "@/components/kit";
import VerificationReport from "@/components/VerificationReport";
import { anchorBadge, explorerTxUrl, fmtDateTime, validationBadge } from "@/lib/client/format";
import { useApi } from "@/lib/client/useApi";

const Cell = ({ children }: { children: React.ReactNode }) => <span style={s(`font-family:${MONO};font-size:12.5px;overflow-wrap:anywhere`)}>{children}</span>;

/** Public receipt view: commitments, validator, anchor and a verification report. Never shows task text, results or evidence content. */
export default function PublicReceipt() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<any>(`/public/receipts/${id}`, { pollMs: undefined });

  if (loading && !data) return <Page><Loading /></Page>;
  if (error && !data) {
    const nf = (error as { status?: number }).status === 404;
    return <Page>{nf ? <Empty title="Receipt not found" text="Check the receipt ID. Receipts are only visible by their unguessable ID." action={<A href="/proof/verify" css="color:#4ADE80;font-size:13.5px">Verify another receipt</A>} /> : <ErrorBox error={error} retry={reload} />}</Page>;
  }
  const { receipt, validation, anchor, verification } = data;
  const link = explorerTxUrl(receipt.anchor?.transactionHash);

  return (
    <Page>
      <div style={s("display:flex;align-items:center;gap:16px;flex-wrap:wrap")}>
        <div style={s("display:flex;flex-direction:column;gap:8px;min-width:0")}>
          <Label>EXECUTION RECEIPT</Label>
          <h1 style={s(`margin:0;font-size:24px;letter-spacing:-0.01em;font-weight:600;font-family:${MONO};overflow-wrap:anywhere`)}>{receipt.receiptId}</h1>
        </div>
        <div style={s("margin-left:auto;display:flex;gap:8px;flex-wrap:wrap")}>
          <Pill large b={validationBadge(receipt.validation.status)} />
          <Pill large b={anchorBadge(receipt.anchor ? "confirmed" : anchor?.status)} />
        </div>
      </div>

      <VerificationReport report={verification} />

      <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px")}>
        <Card gap={16}>
          <Label>COMMITMENTS</Label>
          <KV rows={[
            ["Agent", <Cell key="a">{receipt.agent.id} v{receipt.agent.version}</Cell>],
            ["Task", <Cell key="t">{receipt.task.hash}</Cell>],
            ["Policy", <Cell key="p">{receipt.policy ? receipt.policy.hash : "none"}</Cell>],
            ["Evidence root", <Cell key="e">{receipt.evidence.root} ({receipt.evidence.count} records)</Cell>],
            ["Result", <Cell key="r">{receipt.result.hash}</Cell>],
            ["Receipt hash", <Cell key="h">{receipt.receiptHash}</Cell>],
            ["Created", <Cell key="c">{fmtDateTime(receipt.timestamps?.createdAt)}</Cell>],
          ]} />
        </Card>
        <div style={s("display:flex;flex-direction:column;gap:16px")}>
          <Card gap={14}>
            <Label>VALIDATION RECORD</Label>
            {validation ? (
              <>
                <KV rows={[["Validator", <Cell key="v">{validation.validatorId}@{validation.validatorVersion}</Cell>], ["Outcome", <Pill key="o" b={validationBadge(validation.status)} />], ["Result hash", <Cell key="h">{receipt.validation.resultHash}</Cell>]]} />
                <div style={s("display:flex;flex-direction:column;border:1px solid #1D221F;border-radius:8px;padding:4px 12px")}>
                  {validation.checks.map((c: any) => (
                    <div key={c.id} style={s("display:flex;gap:10px;padding:7px 0;font-size:12.5px;color:#C8D0CB")}>
                      <span style={s(`font-family:${MONO};color:${!c.determinate ? "#CDB274" : c.ok ? "#4ADE80" : "#D08A8A"}`)}>{!c.determinate ? "◷" : c.ok ? "✓" : "✕"}</span>{c.description}
                    </div>
                  ))}
                </div>
              </>
            ) : <span style={s("font-size:13px;color:#7C847F")}>No validation record.</span>}
          </Card>
          <Card gap={14}>
            <Label>ARC ANCHOR</Label>
            {receipt.anchor ? (
              <KV rows={[
                ["Network", <Cell key="n">{receipt.anchor.network} · chain {receipt.anchor.chainId}</Cell>],
                ["Registry", <Cell key="r">{receipt.anchor.registryAddress}</Cell>],
                ["Transaction", <Cell key="t">{receipt.anchor.transactionHash}</Cell>],
                ["Block", <Cell key="b">#{receipt.anchor.blockNumber?.toLocaleString("en-US") ?? "—"}</Cell>],
                ...(link ? [["Explorer", <a key="x" href={link} target="_blank" rel="noreferrer" style={{ color: "#4ADE80" }}>Open ↗</a>] as [string, React.ReactNode]] : []),
              ]} />
            ) : <span style={s("font-size:13px;color:#7C847F")}>{anchor?.status === "submitted" ? "Submitted, awaiting confirmation." : "This receipt has not been anchored."}</span>}
          </Card>
        </div>
      </div>

      <div style={s("border:1px solid #252B27;border-radius:12px;background:#0F1210;padding:20px 22px;display:flex;flex-direction:column;gap:10px;font-size:13px;color:#9BA39E;line-height:1.65")}>
        <Label>WHAT THIS DOES AND DOES NOT PROVE</Label>
        <span>The checks above separate <b style={{ color: "#C8D0CB", fontWeight: 500 }}>integrity</b> (data matches what was committed) from <b style={{ color: "#C8D0CB", fontWeight: 500 }}>facts</b>. Without the underlying data, the task, evidence and result commitments show <Mono>NOT_CHECKED</Mono>. This page shows only commitments and never the private task, evidence or result.</span>
        <span>A passing validation means the named validator returned that outcome under its published rules. It does not prove the validator is independent or that the work is truthful. To verify independently of Verid, use the CLI against the chain: <Mono>verid receipt verify receipt.json --rpc … --registry …</Mono></span>
      </div>
    </Page>
  );
}
