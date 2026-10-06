"use client";

import { s } from "@/lib/style";
import { Card, ErrorBox, KV, Label, Loading, Mono } from "@/components/kit";
import { fmtDateTime } from "@/lib/client/format";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

export default function General() {
  const { me } = useSession();
  const ws = useApi<any>("/workspace");
  const members = useApi<any>("/workspace/members");
  if (ws.loading) return <Loading />;
  if (ws.error) return <ErrorBox error={ws.error} retry={ws.reload} />;
  const w = ws.data;
  return (
    <div style={s("display:flex;flex-direction:column;gap:20px")}>
      <Card gap={16}>
        <Label>WORKSPACE</Label>
        <KV
          rows={[
            ["Name", w.name],
            ["URL handle", <Mono key="s">{w.slug}</Mono>],
            ["Workspace ID", <Mono key="i">{w.id}</Mono>],
            ["Your role", <Mono key="r">{w.role}</Mono>],
            ["Created", <Mono key="c">{fmtDateTime(w.createdAt)}</Mono>],
            ["Signed in as", <Mono key="e">{me?.user.email}</Mono>],
          ]}
        />
      </Card>
      <Card pad={0}>
        <div style={s("padding:16px 22px;border-bottom:1px solid #1D221F")}>
          <Label>MEMBERS</Label>
        </div>
        {members.loading ? (
          <Loading />
        ) : members.error ? (
          <div style={{ padding: 16 }}>
            <ErrorBox error={members.error} retry={members.reload} />
          </div>
        ) : (
          members.data.data.map((m: any) => (
            <div key={m.userId} style={s("display:grid;grid-template-columns:minmax(0,1fr) 110px 130px;gap:16px;align-items:center;min-height:50px;padding:0 22px;border-bottom:1px solid #161A18;font-size:13.5px")}>
              <span style={s("overflow:hidden;text-overflow:ellipsis")}>{m.email}</span>
              <Mono>{m.role}</Mono>
              <Mono color="#7C847F" size={12}>{fmtDateTime(m.joinedAt).slice(0, 10)}</Mono>
            </div>
          ))
        )}
        <div style={s("padding:14px 22px;font-size:12.5px;color:#7C847F")}>Inviting teammates is not available yet.</div>
      </Card>
    </div>
  );
}
