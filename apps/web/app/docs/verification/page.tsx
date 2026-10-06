import { Callout, Code, CodeBlock, H1, H2, P } from "@/components/docs";

export default function Verification() {
  return (
    <>
      <H1 kicker="REFERENCE">Receipts &amp; verification</H1>
      <P>
        A receipt is a portable JSON record of an execution’s <i>commitments</i>. It can be verified without the Verid dashboard or API: recompute the hashes from the underlying data and compare them with the chain.
      </P>

      <H2>What is committed</H2>
      <P>
        Committed (bound by <Code>receiptHash</Code> and mirrored on-chain): schema version, execution ID, agent id and version, task hash, policy hash, evidence root and count, result hash, and the validation status, validator id/version and validation result hash.
        Supplementary (not committed): receipt ID, timestamps, the anchor block, settlement.
      </P>

      <H2>Verify from the command line</H2>
      <CodeBlock>{`# Offline: schema + commitment checks. Chain checks are reported NOT_CHECKED.
verid receipt verify receipt.json --bundle bundle.json

# Against the chain, reading it directly (no Verid server involved):
verid receipt verify receipt.json --bundle bundle.json \\
  --rpc "$ARC_RPC_URL" --registry "$VERID_REGISTRY_ADDRESS"`}</CodeBlock>
      <P>Exit codes: <Code>0</Code> verified · <Code>1</Code> invalid · <Code>2</Code> incomplete (some checks could not run) · <Code>64</Code> usage · <Code>66</Code> unreadable input. Add <Code>--json</Code> for a structured report.</P>

      <H2>Check statuses</H2>
      <CodeBlock title="OUTPUT">{`Receipt schema          VALID
Receipt commitment      VALID
Task commitment         VALID
Evidence commitment     VALID
Result commitment       VALID
Validator record        VALID
Arc transaction         CONFIRMED
Onchain commitments     MATCH

VERIFICATION COMPLETE`}</CodeBlock>
      <P>
        <Code>VALID</Code>/<Code>CONFIRMED</Code>/<Code>MATCH</Code> mean something was recomputed or read from the chain and agreed. <Code>NOT_CHECKED</Code> means the needed input wasn’t supplied. <Code>UNAVAILABLE</Code> means an RPC couldn’t be reached. <Code>PENDING</Code> means the transaction isn’t mined. <Code>INVALID</Code> means a mismatch. Only <i>all checks passing</i> is “verified”; a receipt checked offline is “incomplete”, never “verified”.
      </P>

      <Callout title="THE BUNDLE">
        The verification bundle holds your task, result and evidence <i>commitments</i> so the hashes can be recomputed. It contains your private task and result; share it deliberately. Raw evidence content is never needed for verification and is never in the bundle.
      </Callout>

      <H2>Using the library</H2>
      <CodeBlock title="TYPESCRIPT">{`import { verifyReceipt } from "@verid/core";
import { createArcReader } from "@verid/arc";

const report = await verifyReceipt(receipt, {
  bundle,
  chain: createArcReader({ rpcUrl: process.env.ARC_RPC_URL! }, registryAddress),
});
report.outcome; // "verified" | "incomplete" | "invalid"
report.checks;  // [{ id, label, status, detail }]`}</CodeBlock>
    </>
  );
}
