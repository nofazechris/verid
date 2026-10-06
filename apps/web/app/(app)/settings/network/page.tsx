"use client";

import type { ReactNode } from "react";
import { s } from "@/lib/style";
import { Card, ErrorBox, KV, Label, Loading, Mono, Pill } from "@/components/kit";
import type { NetStatus } from "@/components/Shell";
import { useApi } from "@/lib/client/useApi";

const ok = { label: "OPERATIONAL", icon: "●", fg: "#4ADE80", bg: "rgba(74,222,128,0.07)", bd: "rgba(74,222,128,0.24)" };
const warn = { label: "UNAVAILABLE", icon: "◌", fg: "#CDB274", bg: "rgba(184,154,90,0.09)", bd: "rgba(184,154,90,0.30)" };
const off = { label: "NOT CONFIGURED", icon: "–", fg: "#9BA39E", bg: "rgba(155,163,158,0.05)", bd: "#303832" };
const down = { label: "DOWN", icon: "✕", fg: "#D08A8A", bg: "rgba(166,93,93,0.11)", bd: "rgba(166,93,93,0.38)" };

export default function Network() {
  const { data, error, loading, reload } = useApi<NetStatus>("/network/status", { pollMs: 15_000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} retry={reload} />;
  const { backend, chain } = data!;

  const chainRows: [string, ReactNode][] =
    chain.status === "not_configured"
      ? []
      : [
          ["Network", <Mono key="n">{chain.network}</Mono>],
          ["Registry contract", <Mono key="r">{chain.registryAddress}</Mono>],
          ...(chain.status === "ok"
            ? ([
                ["Chain ID", <Mono key="c">{chain.chainId}</Mono>],
                ["Latest block", <Mono key="b">#{chain.blockNumber.toLocaleString("en-US")}</Mono>],
              ] as [string, ReactNode][])
            : ([["RPC", <span key="x" style={{ color: "#CDB274" }}>Not responding. This is a chain/RPC issue, not a Verid outage.</span>]] as [string, ReactNode][])),
        ];

  return (
    <div style={s("display:flex;flex-direction:column;gap:20px")}>
      <Card gap={14}>
        <div style={s("display:flex;align-items:center;gap:12px")}>
          <Label>VERID BACKEND</Label>
          <span style={s("margin-left:auto")}>
            <Pill b={backend.database === "ok" ? ok : down} />
          </span>
        </div>
        <KV rows={[["API", <Mono key="a">operational</Mono>], ["Database", <Mono key="d">{backend.database}</Mono>]]} />
      </Card>
      <Card gap={14}>
        <div style={s("display:flex;align-items:center;gap:12px")}>
          <Label>ARC CHAIN</Label>
          <span style={s("margin-left:auto")}>
            <Pill b={chain.status === "ok" ? ok : chain.status === "unavailable" ? warn : off} />
          </span>
        </div>
        {chain.status === "not_configured" ? (
          <p style={s("margin:0;font-size:13.5px;color:#9BA39E;line-height:1.6")}>
            This deployment has no Arc network configured, so receipts can be generated and validated but not anchored. Set <Mono>ARC_RPC_URL</Mono>, <Mono>ARC_CHAIN_ID</Mono>, <Mono>VERID_REGISTRY_ADDRESS</Mono> and <Mono>VERID_RELAYER_PRIVATE_KEY</Mono> on the server to enable anchoring.
          </p>
        ) : (
          <KV rows={chainRows} />
        )}
      </Card>
    </div>
  );
}
