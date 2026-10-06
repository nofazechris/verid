"use client";

import { s } from "@/lib/style";
import { A } from "@/components/ui";
import GetStarted from "@/components/GetStarted";
import { Card, Empty, ErrorBox, Label, Loading, Mono, Page, PageTitle, Pill, rowCss, MONO } from "@/components/kit";
import { ago, anchorBadge, executionBadge, short, validationBadge } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

const ACTION_LABEL: Record<string, string> = {
  "execution.created": "Execution created",
  "execution.started": "Execution started",
  "execution.completed": "Evidence committed",
  "validation.recorded": "Validation recorded",
  "receipt.created": "Receipt generated",
  "anchor.submitting": "Anchoring submitted",
  "anchor.confirmed": "Anchored on Arc",
  "anchor.pending": "Anchor pending",
  "anchor.reverted": "Anchor reverted",
  "agent.created": "Agent registered",
  "agent.updated": "Agent updated",
  "policy.created": "Policy created",
  "policy.version_created": "Policy version created",
  "api_key.created": "API key created",
  "api_key.revoked": "API key revoked",
  "validator.created": "Validator created",
  "validator.versioned": "Validator version created",
  "settlement.registered": "Escrow linked",
  "settlement.releasing": "Escrow releasing",
  "settlement.released": "Escrow released",
  "settlement.refunded": "Escrow refunded",
  "settlement.release_pending": "Escrow release pending",
  "settlement.refund_pending": "Escrow refund pending",
  "settlement.release_reverted": "Escrow release reverted",
  "settlement.refund_reverted": "Escrow refund reverted",
};
const dotFor = (a: string) => (a.includes("reverted") ? "#A65D5D" : a.includes("confirmed") || a.includes("validation") ? "#4ADE80" : a.includes("pending") ? "#CDB274" : "#6B736E");

function Tile({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <div style={s("padding:22px 24px;border-right:1px solid #1D221F;height:100%")}>
      <div style={s("font-size:13px;color:#9BA39E")}>{label}</div>
      <div style={s("font-size:30px;font-weight:600;letter-spacing:-0.02em;margin-top:6px;font-variant-numeric:tabular-nums")}>{value}</div>
      {note && <div style={s(`font-family:${MONO};font-size:11.5px;color:#7C847F;margin-top:4px`)}>{note}</div>}
    </div>
  );
  return href ? <A href={href} css="display:block;color:inherit" hover="background:#131714;color:inherit">{body}</A> : body;
}

export default function Overview() {
  const canWrite = useCan("developer");
  const ov = useApi<any>("/overview", { pollMs: 5_000 }); // quick polling so the first real execution appears on its own
  const act = useApi<any>("/activity?limit=12", { pollMs: 15_000 });

  if (ov.loading && !ov.data) return <Page><PageTitle title="Overview" /><Loading /></Page>;
  if (ov.error && !ov.data) return <Page><PageTitle title="Overview" /><ErrorBox error={ov.error} retry={ov.reload} /></Page>;
  const o = ov.data!;
  const empty = o.totalExecutions === 0;
  const settled = Number(o.usdcSettledBaseUnits) / 1e6;

  return (
    <Page>
      <PageTitle title="Overview" sub="Autonomous work across your workspace." />

      {empty && (canWrite ? <GetStarted /> : <Empty title="No executions yet" text="A developer in this workspace needs to connect an agent. Once it reports in, its work appears here." />)}

      <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));border:1px solid #252B27;border-radius:12px;background:#101311;overflow:hidden")}>
        <Tile label="Executions" value={o.totalExecutions.toLocaleString("en-US")} />
        <Tile label="Validated" value={o.validatedExecutions.toLocaleString("en-US")} />
        <Tile label="Validation pass rate" value={o.validationPassRate === null ? "—" : `${(o.validationPassRate * 100).toFixed(1)}%`} note={o.validationPassRate === null ? "no validations yet" : undefined} />
        <Tile label="USDC settled" value={`$${settled.toFixed(2)}`} note={settled > 0 ? "released from on-chain escrows · view" : "no escrow released yet · view"} href="/settlements" />
      </div>

      <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px")}>
        <Card pad={0}>
          <div style={s("padding:16px 20px;border-bottom:1px solid #1D221F;display:flex;align-items:center;gap:10px")}>
            <span style={s("font-size:14px;font-weight:500")}>Activity</span>
            <span style={s(`margin-left:auto;font-family:${MONO};font-size:11px;color:#7C847F`)}>audit log</span>
          </div>
          {act.loading && !act.data ? <Loading /> : act.data?.data.length ? (
            act.data.data.map((a: any) => (
              <div key={a.id} style={s("min-height:52px;display:flex;align-items:center;gap:14px;padding:8px 20px;border-bottom:1px solid #161A18")}>
                <span style={s(`width:7px;height:7px;border-radius:50%;background:${dotFor(a.action)};flex:none`)} />
                <div style={s("display:flex;flex-direction:column;min-width:0")}>
                  <span style={s("font-size:13.5px")}>{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span style={s(`font-family:${MONO};font-size:11.5px;color:#7C847F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`)}>{a.targetId ?? a.actorType}</span>
                </div>
                <span style={s(`margin-left:auto;font-family:${MONO};font-size:11.5px;color:#7C847F;flex:none`)}>{ago(a.createdAt)}</span>
              </div>
            ))
          ) : (
            <Empty title="No activity yet" text="Events appear here as executions, validations and anchors happen in this workspace." />
          )}
        </Card>

        <div style={s("display:flex;flex-direction:column;gap:16px")}>
          <Card pad={0}>
            <div style={s("padding:16px 20px;border-bottom:1px solid #1D221F;font-size:14px;font-weight:500")}>Recent failed validations</div>
            {o.recentFailedValidations.length === 0 ? (
              <div style={s("padding:18px 20px;font-size:13px;color:#7C847F")}>None. Failed validations are preserved here when they occur.</div>
            ) : o.recentFailedValidations.map((f: any) => (
              <A key={f.executionId} href={`/executions/${f.executionId}`} css={rowCss("1fr auto auto", 46)} hover="background:#151917;color:#E8ECE9">
                <Mono>{short(f.executionId, 8, 4)}</Mono><Pill b={validationBadge(f.status)} /><Mono color="#7C847F" size={12}>{ago(f.validatedAt)}</Mono>
              </A>
            ))}
          </Card>
          <Card pad={0}>
            <div style={s("padding:16px 20px;border-bottom:1px solid #1D221F;font-size:14px;font-weight:500")}>Recent Arc anchors</div>
            {o.recentAnchors.length === 0 ? (
              <div style={s("padding:18px 20px;font-size:13px;color:#7C847F")}>No anchors yet. Anchor a validated receipt from its page.</div>
            ) : o.recentAnchors.map((a: any) => (
              <A key={a.receiptId} href={`/receipts/${a.receiptId}`} css={rowCss("1fr auto auto", 46)} hover="background:#151917;color:#E8ECE9">
                <Mono>{short(a.transactionHash)}</Mono><Pill b={anchorBadge(a.status)} /><Mono color="#7C847F" size={12}>{a.blockNumber ? `#${a.blockNumber.toLocaleString("en-US")}` : "—"}</Mono>
              </A>
            ))}
          </Card>
        </div>
      </div>

      <Card pad={0}>
        <div style={s("display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid #1D221F")}>
          <span style={s("font-size:14px;font-weight:500")}>Recent executions</span>
          <A href="/executions" css="margin-left:auto;font-size:13px;color:#9BA39E">View all →</A>
        </div>
        {o.recentExecutions.length === 0 ? <Empty title="No executions yet" text="Connect an agent: the steps are at the top of this page." /> : o.recentExecutions.map((e: any) => (
          <A key={e.id} href={`/executions/${e.id}`} css={rowCss("minmax(0,1fr) 150px 190px 80px", 48)} hover="background:#151917;color:#E8ECE9">
            <Mono>{short(e.id, 10, 4)}</Mono><span style={s("font-size:13.5px")}>{e.agentName}</span><span><Pill b={executionBadge(e.status)} /></span><Mono color="#7C847F" size={12}>{ago(e.createdAt)}</Mono>
          </A>
        ))}
      </Card>
      <Label>Metrics are derived from this workspace’s records. Nothing on this page is simulated.</Label>
    </Page>
  );
}
