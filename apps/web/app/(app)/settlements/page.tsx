"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Card, Empty, ErrorBox, Label, Loading, Mono, Page, PageTitle, Spinner, Table, ghostBtn, ghostHover, rowCss, MONO } from "@/components/kit";
import { get } from "@/lib/client/api";
import { ago, executionBadge, short } from "@/lib/client/format";
import { useSession } from "@/lib/client/session";

const COLS = "minmax(0,1.1fr) 120px 150px 150px 120px 110px 90px";
const STATUSES = ["all", "escrowed", "released", "refunded"] as const;

const usdc = (base: string) => `${Number(formatUnits(BigInt(base), 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function StatusPill({ status }: { status: string }) {
  const c = status === "released" ? ["#4ADE80", "rgba(74,222,128,0.07)", "rgba(74,222,128,0.24)"] : status === "refunded" ? ["#D08A8A", "rgba(166,93,93,0.08)", "rgba(166,93,93,0.3)"] : ["#CDB274", "rgba(205,178,116,0.07)", "rgba(205,178,116,0.28)"];
  return <span style={s(`display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;font-family:${MONO};font-size:11px;letter-spacing:0.06em;color:${c[0]};background:${c[1]};border:1px solid ${c[2]}`)}>{status.toUpperCase()}</span>;
}

function Tile({ label, amount, count, color }: { label: string; amount: string; count: number; color: string }) {
  return (
    <div style={s("padding:20px 22px;display:flex;flex-direction:column;gap:6px;min-width:0")}>
      <span style={s("font-size:13px;color:#9BA39E")}>{label}</span>
      <span style={s(`font-size:26px;font-weight:600;letter-spacing:-0.02em;color:${color}`)}>{usdc(amount)} <span style={s("font-size:13px;font-weight:400;color:#7C847F")}>USDC</span></span>
      <span style={s(`font-family:${MONO};font-size:11.5px;color:#7C847F`)}>{count} {count === 1 ? "escrow" : "escrows"}</span>
    </div>
  );
}

export default function Settlements() {
  const { workspaceId } = useSession();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>();
  const [tick, setTick] = useState(0);
  const qs = (extra = "") => `/settlements?limit=25${status === "all" ? "" : `&status=${status}`}${extra}`;

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(undefined);
    get<any>(qs(), ctl.signal)
      .then((r) => { setRows(r.data); setTotals(r.totals); setCursor(r.nextCursor); setLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { setError(e); setLoading(false); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, status, tick]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const r = await get<any>(qs(`&cursor=${cursor}`));
      setRows((x) => [...x, ...r.data]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
  };

  const anyAtAll = totals && (totals.escrowed.count + totals.released.count + totals.refunded.count) > 0;

  return (
    <Page>
      <PageTitle title="Settlements" sub="USDC escrows linked to executions. Funds are held by the escrow contract and move only after a validation Pass and an anchor, or back to the payer." />

      {totals && (
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));border:1px solid #252B27;border-radius:12px;background:#101311;overflow:hidden")}>
          <Tile label="Held in escrow" amount={totals.escrowed.amount} count={totals.escrowed.count} color="#CDB274" />
          <Tile label="Released to payees" amount={totals.released.amount} count={totals.released.count} color="#4ADE80" />
          <Tile label="Refunded to payers" amount={totals.refunded.amount} count={totals.refunded.count} color="#D08A8A" />
        </div>
      )}

      <div style={s("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
        {STATUSES.map((x) => (
          <Btn key={x} onClick={() => setStatus(x)} css={`height:32px;padding:0 12px;border-radius:8px;border:1px solid ${status === x ? "#3A443D" : "#252B27"};background:${status === x ? "#151917" : "transparent"};color:${status === x ? "#E8ECE9" : "#9BA39E"};font-size:13px;cursor:pointer`} hover="background:#151917;color:#E8ECE9">
            {x === "all" ? "All" : x.charAt(0).toUpperCase() + x.slice(1)}
          </Btn>
        ))}
      </div>

      {error ? <ErrorBox error={error} retry={() => setTick((t) => t + 1)} /> : loading ? <Loading /> : (
        <Table cols={COLS} head={["EXECUTION", "AMOUNT", "PAYER", "PAYEE", "STATUS", "EXECUTION STATE", "LINKED"]} minWidth={1000}>
          {rows.length === 0 ? (
            <Empty
              title={anyAtAll ? "No escrows with this status." : "No escrows yet."}
              text={anyAtAll ? "Try another filter." : "Open an execution and use its USDC settlement panel to fund an escrow and link it. Escrows appear here once linked."}
              action={!anyAtAll ? <A href="/executions" css="color:#4ADE80;font-size:13.5px">Go to executions</A> : undefined}
            />
          ) : rows.map((r) => (
            <A key={r.id} href={`/executions/${r.executionId}`} css={rowCss(COLS, 56)} hover="background:#151917;color:#E8ECE9">
              <span style={s("display:flex;flex-direction:column;min-width:0")}>
                <Mono>{short(r.executionId, 10, 4)}</Mono>
                <span style={s("font-size:12px;color:#7C847F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.agentName}</span>
              </span>
              <span style={s("font-size:14px;font-weight:500")}>{usdc(r.amount)} <span style={s("font-size:11px;color:#7C847F;font-weight:400")}>USDC</span></span>
              <Mono color="#9BA39E" size={12}>{short(r.requesterAddress, 6, 4)}</Mono>
              <Mono color="#9BA39E" size={12}>{short(r.recipientAddress, 6, 4)}</Mono>
              <span><StatusPill status={r.status} /></span>
              <span style={{ display: "flex", minWidth: 0 }}><span style={{ fontFamily: MONO, fontSize: 11.5, color: "#9BA39E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{executionBadge(r.executionStatus).label.toLowerCase()}</span></span>
              <Mono color="#7C847F" size={12}>{ago(r.createdAt)}</Mono>
            </A>
          ))}
        </Table>
      )}
      {cursor && !loading && <Btn onClick={loadMore} disabled={more} css={ghostBtn + ";align-self:flex-start"} hover={ghostHover}>{more ? <Spinner /> : null} Load more</Btn>}
      <Card pad={16}>
        <Label>HOW TO READ THIS</Label>
        <p style={s("margin:8px 0 0;font-size:12.5px;line-height:1.6;color:#9BA39E")}>
          This is the recorded view. The chain is the source of truth for funds, so open an escrow to see its live on-chain state. A release means a registered validator recorded a Pass and the receipt was anchored; it does not mean the work was correct. Amounts are USDC, 6 decimals.
        </p>
      </Card>
    </Page>
  );
}
