"use client";

import { useState } from "react";
import { s } from "@/lib/style";
import { A, Btn } from "@/components/ui";
import { Label, Mono, Pill, Spinner, MONO } from "@/components/kit";
import { ago, healthBadge } from "@/lib/client/format";
import { connectSnippets, type Lang } from "@/lib/client/snippets";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";

/**
 * "How do I make this agent report to Verid?" Shows the install command and the code for THIS server and THIS agent,
 * and watches for the agent's first real run so the developer sees it land.
 */
export default function ConnectAgent({ slug, compact }: { slug: string; compact?: boolean }) {
  const { toast } = useSession();
  const [lang, setLang] = useState<Lang>("node");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-verid-host";
  const snip = connectSnippets(origin, slug);
  const agents = useApi<any>("/agents?limit=100", { pollMs: 4000 });
  const mine = agents.data?.data?.find((a: any) => a.slug === slug);
  const runs = mine?.monitoring?.recentRuns ?? 0;

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast("Copied");
  };
  const tab = (l: Lang, label: string) => (
    <Btn key={l} onClick={() => setLang(l)} css={`height:28px;padding:0 12px;border-radius:7px;border:1px solid ${lang === l ? "#3A443D" : "#252B27"};background:${lang === l ? "#151917" : "transparent"};color:${lang === l ? "#E8ECE9" : "#9BA39E"};font-size:12.5px;cursor:pointer`} hover="background:#151917;color:#E8ECE9">{label}</Btn>
  );
  const block = (title: string, text: string) => (
    <div style={s("border:1px solid #1D221F;border-radius:10px;background:#0A0C0B;overflow:hidden")}>
      <div style={s("display:flex;align-items:center;height:32px;padding:0 10px 0 14px;border-bottom:1px solid #161A18;background:#0F1210")}>
        <span style={s(`font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;color:#7C847F`)}>{title}</span>
        <Btn onClick={() => copy(text)} css="margin-left:auto;height:22px;padding:0 8px;border-radius:5px;border:1px solid #252B27;background:transparent;color:#9BA39E;font-size:11.5px;cursor:pointer" hover="color:#E8ECE9;border-color:#303832">Copy</Btn>
      </div>
      <pre style={s(`margin:0;padding:12px 14px;overflow-x:auto;font-family:${MONO};font-size:12.2px;line-height:1.65;color:#C8D0CB;max-height:${compact ? 260 : 420}px`)}>{text}</pre>
    </div>
  );

  return (
    <div style={s("display:flex;flex-direction:column;gap:16px")}>
      <div style={s("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
        <Label>LANGUAGE</Label>
        {tab("node", "Node.js")}{tab("python", "Python")}{tab("curl", "Plain HTTP")}
      </div>

      {lang !== "curl" && block("1 · INSTALL", snip.install[lang])}
      {block(lang === "curl" ? "THE LIFECYCLE" : "2 · WRAP YOUR AGENT", snip.code[lang])}

      <div style={s("display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:#9BA39E;line-height:1.6")}>
        <span><b style={{ color: "#C8D0CB", fontWeight: 500 }}>Set two environment variables</b> where your agent runs: <Mono size={12}>VERID_API_KEY</Mono> (<A href="/settings/keys" css="color:#4ADE80">create a key</A>) and, for plain HTTP, the server address <Mono size={12}>{origin}</Mono>. Keep the key on the server side; never ship it to a browser.</span>
        <span>The SDK is not on npm yet. This server hosts it, so installing needs no account. <A href="/docs/sdk" css="color:#4ADE80">SDK docs</A></span>
      </div>

      <div style={s(`display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;border-radius:10px;border:1px solid ${runs ? "rgba(74,222,128,0.3)" : "#252B27"};background:${runs ? "rgba(74,222,128,0.05)" : "#0F1210"}`)}>
        {runs ? (
          <>
            <span style={s("color:#4ADE80;font-family:'Geist Mono',monospace")}>✓</span>
            <span style={s("font-size:13.5px")}>
              <b style={{ fontWeight: 500 }}>{slug}</b> reported {runs} run{runs === 1 ? "" : "s"}. Last run {ago(mine.monitoring.lastRunAt)}.
            </span>
            <Pill b={healthBadge(mine.monitoring.health)} />
            <A href={`/agents/${mine.id}`} css="margin-left:auto;color:#4ADE80;font-size:13px">Open this agent →</A>
          </>
        ) : (
          <>
            <Spinner size={12} />
            <span style={s("font-size:13.5px;color:#9BA39E")}>Waiting for the first run from <b style={{ color: "#C8D0CB", fontWeight: 500 }}>{slug}</b>. This updates by itself.</span>
          </>
        )}
      </div>
    </div>
  );
}
