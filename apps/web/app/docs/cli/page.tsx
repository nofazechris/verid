import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, P, Table, UL } from "@/components/docs";

export default function Cli() {
  return (
    <>
      <H1 kicker="GUIDES">Command-line tool</H1>
      <P>
        <Code>verid receipt verify</Code> checks a receipt without using the Verid dashboard or API. It recomputes every hash from the data you give it and, if you point it at an Arc RPC endpoint, reads the transaction and registry state directly from the chain. This is how a skeptical third party verifies a receipt without trusting you or Verid.
      </P>
      <Callout title="NOT PUBLISHED TO NPM YET">
        The CLI lives in the open-source repository (<Code>packages/cli</Code>). Until a bundled release is published, run it from a checkout: <Code>node packages/cli/bin/verid.mjs receipt verify …</Code>. The examples below write it as <Code>verid</Code> for readability.
      </Callout>

      <H2>Usage</H2>
      <CodeBlock>{`verid receipt verify <receipt.json> [options]

  --bundle <file>    JSON with any of: task, policy, evidence, result, validation.
                     Each supplied item is recomputed and compared to its commitment.
  --rpc <url>        Arc RPC endpoint (default: $ARC_RPC_URL). Without it, chain
                     checks are reported NOT_CHECKED.
  --registry <addr>  VeridRegistry address (default: $VERID_REGISTRY_ADDRESS).
  --json             Print the structured report as JSON.
  -h, --help         Show help.`}</CodeBlock>

      <H2>Where the inputs come from</H2>
      <UL>
        <li><b>Receipt and bundle:</b> on the receipt page choose <i>Export receipt JSON</i> and <i>Export verification bundle</i>. The page also prints a ready-made command.</li>
        <li><b>RPC and registry address:</b> the network and registry address published by whoever operates the deployment, for Arc see the <A href="/docs/self-hosting" css="color:#4ADE80">configuration reference</A>. Use your own node or several providers for high-stakes checks.</li>
      </UL>

      <H2>Three levels of checking</H2>
      <CodeBlock>{`# 1) Offline, receipt only: schema and receipt-hash checks. Chain checks: NOT_CHECKED.
verid receipt verify receipt.json

# 2) Offline with the bundle: also recomputes task, evidence, result and validation hashes.
verid receipt verify receipt.json --bundle bundle.json

# 3) Full: also reads the Arc transaction and registry directly from the chain.
verid receipt verify receipt.json --bundle bundle.json \\
  --rpc "$ARC_RPC_URL" --registry "$VERID_REGISTRY_ADDRESS"`}</CodeBlock>
      <P>Only level 3 can end in <i>verified</i>. A receipt checked offline is reported <i>incomplete</i>, never verified, because the checks that could not run are not assumed to pass.</P>

      <H2>Exit codes</H2>
      <Table
        head={["CODE", "MEANING", "SCRIPTING USE"]}
        cols="minmax(70px,0.4fr) minmax(0,1.6fr) minmax(0,1.6fr)"
        rows={[
          [<Code key="0">0</Code>, "Verified: every check ran and passed.", "Safe to proceed."],
          [<Code key="1">1</Code>, "Invalid: something does not match.", "Reject."],
          [<Code key="2">2</Code>, "Incomplete: some checks could not run (no bundle, no RPC, RPC down, transaction pending).", "Do not treat as verified. Retry with more inputs."],
          [<Code key="64">64</Code>, "Usage error.", "Fix the command."],
          [<Code key="66">66</Code>, "Input could not be read or is not valid JSON.", "Check the file."],
        ]}
      />

      <H2>Reading the output</H2>
      <CodeBlock title="OUTPUT">{`VERID RECEIPT VERIFICATION

Receipt schema          VALID
Receipt commitment      VALID
Task commitment         VALID
Policy commitment       VALID
Evidence commitment     VALID
Result commitment       VALID
Validator record        VALID
Arc transaction         CONFIRMED  (block 3)
Onchain commitments     MATCH

VERIFICATION COMPLETE`}</CodeBlock>
      <Table
        head={["STATUS", "MEANING"]}
        cols="minmax(130px,0.6fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">VALID / CONFIRMED / MATCH</Code>, "Something was recomputed or read from the chain, and it agreed."],
          [<Code key="2">INVALID</Code>, "It was checked and does not agree. Treat the receipt as unreliable."],
          [<Code key="3">NOT_CHECKED</Code>, "The input needed for this check was not supplied."],
          [<Code key="4">UNAVAILABLE</Code>, "The RPC could not be reached."],
          [<Code key="5">PENDING</Code>, "The anchoring transaction is not mined yet."],
        ]}
      />
      <P>
        A plausible-looking transaction hash is not enough. The verifier reads the registry record from the chain and requires it to equal the receipt’s commitments, and requires the transaction to target the configured registry on the configured chain.
      </P>
      <P>More background on what a pass means: <A href="/docs/verification" css="color:#4ADE80">Receipts &amp; verification</A> and <A href="/docs/trust-model" css="color:#4ADE80">Trust model</A>.</P>
    </>
  );
}
