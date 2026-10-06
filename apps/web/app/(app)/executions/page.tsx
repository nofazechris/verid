"use client";

import { useEffect, useState } from "react";
import { s } from "@/lib/style";
import { A, Btn, Field } from "@/components/ui";
import { Empty, ErrorBox, Loading, Mono, Page, PageTitle, Pill, Spinner, Table, ghostBtn, ghostHover, inputCss, rowCss } from "@/components/kit";
import { get } from "@/lib/client/api";
import { ago, executionBadge, short, validationBadge } from "@/lib/client/format";
import { useSession } from "@/lib/client/session";

const STATUSES = ["all", "created", "running", "awaiting_validation", "validated", "validation_failed", "anchoring", "anchored", "settling", "settled", "failed"] as const;
const COLS = "130px 150px minmax(0,1fr) 190px 130px 90px";

export default function Executions() {
  const { workspaceId } = useSession();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [validation, setValidation] = useState("all");
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const qs = (cur?: string) => {
    const p = new URLSearchParams({ limit: "25" });
    if (dq) p.set("q", dq);
    if (status !== "all") p.set("status", status);
    if (validation !== "all") p.set("validation", validation);
    if (cur) p.set("cursor", cur);
    return `/executions?${p}`;
  };

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(undefined);
    get<{ data: any[]; nextCursor: string | null }>(qs(), ctl.signal)
      .then((r) => { setRows(r.data); setCursor(r.nextCursor); setLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { setError(e); setLoading(false); } });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, status, validation, workspaceId, tick]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const r = await get<{ data: any[]; nextCursor: string | null }>(qs(cursor));
      setRows((x) => [...x, ...r.data]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
  };

  const filtered = !!(dq || status !== "all" || validation !== "all");
  return (
    <Page>
      <PageTitle title="Executions" sub="Observe, inspect, and verify autonomous work." />
      <div style={s("display:flex;gap:10px;flex-wrap:wrap;align-items:center")}>
        <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID or agent…" css={inputCss + ";width:280px"} focus="border-color:#2C8A66" />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={s("height:36px;padding:0 10px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;font-size:13px;cursor:pointer")}>
          {STATUSES.map((x) => <option key={x} value={x}>{x === "all" ? "Any status" : executionBadge(x).label.toLowerCase()}</option>)}
        </select>
        <select aria-label="Validation" value={validation} onChange={(e) => setValidation(e.target.value)} style={s("height:36px;padding:0 10px;border-radius:8px;border:1px solid #252B27;background:#101311;color:#E8ECE9;font-size:13px;cursor:pointer")}>
          <option value="all">Any validation</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="inconclusive">Inconclusive</option>
        </select>
        {filtered && <Btn onClick={() => { setQ(""); setStatus("all"); setValidation("all"); }} css={ghostBtn + ";height:36px"} hover={ghostHover}>Clear filters</Btn>}
      </div>

      {error ? <ErrorBox error={error} retry={() => setTick((t) => t + 1)} /> : loading ? <Loading /> : (
        <Table cols={COLS} head={["EXECUTION", "AGENT", "TASK", "STATUS", "VALIDATION", "CREATED"]} minWidth={900}>
          {rows.length === 0 ? (
            <Empty title={filtered ? "No executions match these filters." : "No executions yet."} text={filtered ? "Try a different status, or search by execution ID." : "Executions appear when an agent reports in through the API. The Overview page has the steps."} />
          ) : rows.map((e) => (
            <A key={e.id} href={`/executions/${e.id}`} css={rowCss(COLS)} hover="background:#151917;color:#E8ECE9">
              <Mono>{short(e.id, 10, 4)}</Mono>
              <span style={s("font-size:13.5px")}>{e.agentName}</span>
              <span style={s("font-size:13.5px;color:#9BA39E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{e.taskDescription}</span>
              <span><Pill b={executionBadge(e.status)} /></span>
              <span><Pill b={validationBadge(e.validationStatus)} /></span>
              <Mono color="#7C847F" size={12}>{ago(e.createdAt)}</Mono>
            </A>
          ))}
        </Table>
      )}
      {cursor && !loading && (
        <Btn onClick={loadMore} disabled={more} css={ghostBtn + ";align-self:flex-start"} hover={ghostHover}>{more ? <Spinner /> : null} Load more</Btn>
      )}
    </Page>
  );
}
