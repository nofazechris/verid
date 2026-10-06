"use client";

import { useEffect, useState } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Empty, ErrorBox, Loading, Mono, Page, PageTitle, Pill, Spinner, Table, ghostBtn, ghostHover, rowCss } from "@/components/kit";
import { get } from "@/lib/client/api";
import { ago, executionBadge, short, validationBadge } from "@/lib/client/format";
import { useSession } from "@/lib/client/session";

const COLS = "minmax(0,1.2fr) 130px 130px 190px 90px";

export default function Receipts() {
  const { workspaceId } = useSession();
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(undefined);
    get<{ data: any[]; nextCursor: string | null }>("/receipts?limit=25", ctl.signal)
      .then((r) => { setRows(r.data); setCursor(r.nextCursor); setLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { setError(e); setLoading(false); } });
    return () => ctl.abort();
  }, [workspaceId, tick]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const r = await get<{ data: any[]; nextCursor: string | null }>(`/receipts?limit=25&cursor=${cursor}`);
      setRows((x) => [...x, ...r.data]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
  };

  return (
    <Page>
      <PageTitle title="Receipts" sub="Every validated execution can produce a portable, independently verifiable receipt." />
      {error ? <ErrorBox error={error} retry={() => setTick((t) => t + 1)} /> : loading ? <Loading /> : (
        <Table cols={COLS} head={["RECEIPT", "VALIDATION", "EXECUTION", "STATE", "CREATED"]} minWidth={820}>
          {rows.length === 0 ? <Empty title="No receipts yet" text="A receipt is generated for an execution after it is validated. Receipts appear after an execution is validated." /> : rows.map((r) => (
            <A key={r.id} href={`/receipts/${r.id}`} css={rowCss(COLS)} hover="background:#151917;color:#E8ECE9">
              <Mono>{short(r.id, 12, 4)}</Mono>
              <span><Pill b={validationBadge(r.validationStatus)} /></span>
              <Mono color="#9BA39E">{short(r.executionId, 8, 4)}</Mono>
              <span><Pill b={executionBadge(r.executionStatus)} /></span>
              <Mono color="#7C847F" size={12}>{ago(r.createdAt)}</Mono>
            </A>
          ))}
        </Table>
      )}
      {cursor && !loading && <Btn onClick={loadMore} disabled={more} css={ghostBtn + ";align-self:flex-start"} hover={ghostHover}>{more ? <Spinner /> : null} Load more</Btn>}
      <span style={s("font-size:12px;color:#7C847F")}>A receipt proves integrity relative to its commitments. It does not prove the underlying claims were true.</span>
    </Page>
  );
}
