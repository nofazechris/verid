"use client";

import { s } from "@/lib/style";
import { A } from "@/components/ui";
import { Card, Mono, Spinner, MONO } from "@/components/kit";
import { useApi } from "@/lib/client/useApi";

/**
 * Shown while a workspace has no runs. Not a demo: it points at the guided walkthrough, which connects a REAL agent.
 * It flips away by itself when the first real execution arrives.
 */
export default function GetStarted() {
  const ob = useApi<any>("/onboarding", { pollMs: 5000 });
  const d = ob.data;
  const steps: [string, boolean][] = [
    ["Create an API key", !!d && d.apiKeys > 0],
    ["Make an agent report a real run", !!d && d.executions > 0],
    ["Watch it get validated and anchored", !!d && d.passed > 0],
  ];
  const next = steps.findIndex(([, ok]) => !ok);

  return (
    <Card pad={26} gap={20} css="border-color:#2C8A66;background:#0F1512;">
      <div style={s("display:flex;flex-direction:column;gap:6px;max-width:760px")}>
        <span style={s("font-size:18px;font-weight:500")}>Connect your first agent</span>
        <span style={s("font-size:13.5px;color:#9BA39E;line-height:1.6")}>
          Verid records what your software does, checks the result against rules on its own server, and publishes a verifiable receipt on Arc. Nothing shows up here until a real agent reports in. The guided tour takes about two minutes: it runs a real sample agent and ends with a proof link you can send to someone.
        </span>
      </div>

      <div style={s("display:flex;flex-direction:column;gap:10px")}>
        {steps.map(([label, ok], i) => (
          <div key={label} style={s("display:flex;align-items:center;gap:12px;font-size:13.5px")}>
            <span style={s(`flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-family:${MONO};font-size:11px;border:1px solid ${ok ? "#2C8A66" : i === next ? "#4ADE80" : "#303832"};background:${ok ? "#10241A" : "transparent"};color:${ok || i === next ? "#4ADE80" : "#7C847F"}`)}>{ok ? "✓" : i + 1}</span>
            <span style={{ color: ok ? "#9BA39E" : "#E8ECE9" }}>{label}</span>
            {i === next && d && <span style={s("display:flex;align-items:center;gap:6px;font-size:12px;color:#7C847F")}><Spinner size={11} /> next</span>}
          </div>
        ))}
      </div>

      <div style={s("display:flex;gap:10px;flex-wrap:wrap;align-items:center")}>
        <A href="/get-started?tour=1" css="display:inline-flex;align-items:center;height:40px;padding:0 18px;border-radius:9px;background:#E8ECE9;color:#0B0D0C;font-size:14px;font-weight:500" hover="background:#FFFFFF;color:#0B0D0C">Take the guided tour</A>
        <A href="/agents" css="display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:9px;border:1px solid #303832;color:#E8ECE9;font-size:14px" hover="background:#151917;color:#E8ECE9">Add an agent</A>
        <span style={s("font-size:12.5px;color:#7C847F")}>Prefer to read first? <A href="/docs/overview" css="color:#4ADE80">What is Verid?</A> · <A href="/docs/examples" css="color:#4ADE80">Examples</A> · <Mono size={12}>SDK</Mono> <A href="/docs/sdk" css="color:#4ADE80">docs</A></span>
      </div>
    </Card>
  );
}
