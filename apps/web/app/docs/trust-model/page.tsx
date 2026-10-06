import { Callout, Code, H1, H2, P } from "@/components/docs";
import { s } from "@/lib/style";

const ROWS: [string, string, string][] = [
  ["The receipt hasn’t been altered since it was committed", "Recomputing receiptHash", "That the original claims were true"],
  ["Evidence you hold equals the evidence that was committed", "Recomputing the evidence root", "That a tool call really happened, or that an external API was honest"],
  ["The result you hold equals the committed result", "Recomputing the result hash", "That the result is factually correct"],
  ["A named validator recorded outcome X", "Recomputing the validation record hash", "That the validator is independent, unbiased or correct"],
  ["These commitments were published by an authorized anchorer", "Reading the transaction and registry from the chain", "Anything about the real world"],
];

export default function TrustModel() {
  return (
    <>
      <H1 kicker="CONCEPTS">Trust model</H1>
      <P>
        Verid proves <b style={{ color: "#E8ECE9", fontWeight: 500 }}>integrity</b>, not truth. A hash proves data matches a previously committed value. It does not prove the data was honest, that an external API told the truth, or that a tool call genuinely occurred. Verid never claims more than it checks.
      </P>
      <div style={s("border:1px solid #252B27;border-radius:12px;background:#101311;max-width:960px;overflow:hidden")}>
        <div style={s("display:grid;grid-template-columns:1.2fr 1fr 1.2fr;gap:16px;padding:12px 18px;border-bottom:1px solid #1D221F;font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:0.08em;color:#7C847F")}>
          <span>VERIFIED CLAIM</span><span>HOW</span><span>NOT ESTABLISHED</span>
        </div>
        {ROWS.map(([a, b, c]) => (
          <div key={a} style={s("display:grid;grid-template-columns:1.2fr 1fr 1.2fr;gap:16px;padding:14px 18px;border-bottom:1px solid #161A18;font-size:13px;line-height:1.55")}>
            <span style={s("color:#C8D0CB")}>{a}</span><span style={s("color:#9BA39E")}>{b}</span><span style={s("color:#D08A8A")}>{c}</span>
          </div>
        ))}
      </div>

      <H2>Disclosed trust dependencies</H2>
      <ul style={{ margin: 0, paddingLeft: 20, color: "#9BA39E", fontSize: 14.5, lineHeight: 1.8, maxWidth: 760 }}>
        <li><b>Anchorers.</b> Only allowlisted addresses can write to the registry (otherwise anyone could squat a guessable execution key). The registry owner is therefore a trust dependency.</li>
        <li><b>Validators.</b> A validation record is a claim by a designated validator under published rules.</li>
        <li><b>Agent-supplied evidence</b> is untrusted until independently checked. The root only proves it wasn’t changed afterwards.</li>
        <li><b>The RPC</b> you verify against. Use your own node, or several, for high-stakes checks.</li>
      </ul>

      <H2>Privacy</H2>
      <P>Only commitments and minimal identifiers are ever published. Raw prompts, results, evidence content, credentials and personal data stay off-chain. Public receipt pages show commitments, the validator and the anchor — never the task, result or evidence.</P>
      <Callout title="WHAT A POLICY HASH MEANS">
        Recording a policy hash proves <i>which rules were declared</i>. It does not prove the agent obeyed them. Compliance needs evidence or enforcement appropriate to each rule. See <Code>docs/architecture.md</Code> in the repository for the exact hashing and root construction.
      </Callout>
    </>
  );
}
