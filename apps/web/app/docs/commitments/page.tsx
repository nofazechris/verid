import { Callout, Code, CodeBlock, H1, H2, P, Table, UL } from "@/components/docs";

export default function Commitments() {
  return (
    <>
      <H1 kicker="REFERENCE">Commitments &amp; hashing</H1>
      <P>
        This page is for people writing an independent verifier or auditing Verid. It states exactly how each fingerprint is computed. The authoritative text is <Code>docs/architecture.md</Code> in the repository; if the code and that document disagree, that is a bug.
      </P>

      <H2>Canonical JSON</H2>
      <P>
        Values are serialized in a canonical form before hashing, following RFC 8785 (JCS): no insignificant whitespace, object keys sorted by UTF-16 code unit order, numbers via the ECMAScript number-to-string algorithm, strings escaped as <Code>JSON.stringify</Code> does. Unlike <Code>JSON.stringify</Code> it is strict: <Code>undefined</Code>, functions, symbols, <Code>bigint</Code>, <Code>NaN</Code>, infinities, <Code>-0</Code>, non-plain objects (Date, Map, class instances) and cycles are errors, never silently coerced.
      </P>
      <Callout title="CROSS-LANGUAGE NOTE">
        Another implementation must reproduce the ECMAScript number algorithm exactly. For high-precision numbers prefer strings.
      </Callout>

      <H2>Domain-separated hashes</H2>
      <CodeBlock title="DEFINITION">{`commit(domain, value) = keccak256( utf8(domain) || 0x00 || utf8(canonical(value)) )`}</CodeBlock>
      <P>All hashes are keccak256 (native to the EVM): 32 bytes, written as <Code>0x</Code> plus 64 lowercase hex characters.</P>
      <Table
        head={["OBJECT", "DOMAIN TAG"]}
        cols="minmax(0,1fr) minmax(0,1.4fr)"
        rows={[
          ["Task", <Code key="1">VERID/task/v1</Code>],
          ["Policy", <Code key="2">VERID/policy/v1</Code>],
          ["Evidence content", <Code key="3">VERID/evidence-content/v1</Code>],
          ["Result", <Code key="4">VERID/result/v1</Code>],
          ["Validation result", <Code key="5">VERID/validation/v1</Code>],
          ["Receipt", <Code key="6">VERID/receipt/v1</Code>],
          ["Execution key", <Code key="7">VERID/execution-id/v1</Code>],
        ]}
      />
      <P>Because of the tag, a task hash can never equal a policy hash for any input. Changing a tag is a breaking change to the scheme.</P>

      <H2>Execution key</H2>
      <P>The on-chain lookup key for an execution, used by the registry, the validation contract and the escrow:</P>
      <CodeBlock>{`executionKey = keccak256( utf8("VERID/execution-id/v1") || 0x00 || utf8(executionId) )`}</CodeBlock>

      <H2>Evidence root</H2>
      <P>Each evidence record commits <Code>{`{ contentHash, executionId, sequenceNumber, timestamp, type }`}</Code>. A Merkle tree is built over the records in sequence order:</P>
      <CodeBlock>{`leaf = keccak256( 0x00 || canonical({contentHash, executionId, sequenceNumber, timestamp, type}) )
node = keccak256( 0x01 || left || right )
tree = binary Merkle tree over leaves ordered by sequenceNumber (an odd node is promoted, never duplicated)
root = keccak256( 0x02 || uint64_be(count) || treeRoot )     // treeRoot = 32 zero bytes if empty`}</CodeBlock>
      <UL>
        <li>Different prefixes for leaves (<Code>0x00</Code>) and nodes (<Code>0x01</Code>) prevent a leaf being passed off as an inner node.</li>
        <li>Promoting an odd node avoids the duplicate-leaf ambiguity of naive trees.</li>
        <li>The record count is bound into the root, so a prefix of the evidence can never share a root with the full set.</li>
        <li>Sequence numbers must be exactly 0 to n-1 for a single execution. Gaps, duplicates and mixed executions raise an error, so an incomplete set cannot produce a root.</li>
        <li><b>Not committed:</b> <Code>metadata</Code>, <Code>contentReference</Code> and the record <Code>id</Code>. They are unauthenticated and must not be trusted for security decisions. Raw content is stored off-chain; only hashes are published.</li>
      </UL>

      <H2>Receipt (schema v1.0)</H2>
      <Table
        head={["PART", "FIELDS"]}
        cols="minmax(160px,0.7fr) minmax(0,2fr)"
        rows={[
          [<b key="c">Committed</b>, <>Bound by <Code key="h">receiptHash</Code> and mirrored on-chain: <Code key="a">schemaVersion</Code>, <Code key="b">executionId</Code>, <Code key="c2">agent.{`{id,version}`}</Code>, <Code key="d">task.hash</Code>, <Code key="e">policy.hash</Code> (or none), <Code key="f">evidence.{`{root,count}`}</Code>, <Code key="g">result.hash</Code>, <Code key="i">validation.{`{status,validatorId,validatorVersion,resultHash}`}</Code>.</>],
          [<b key="s">Supplementary</b>, <>Not committed: <Code key="r1">receiptId</Code>, <Code key="r2">timestamps</Code>, <Code key="r3">anchor</Code>, <Code key="r4">settlement</Code>. The anchor cannot be committed because it is the output of anchoring the commitment.</>],
        ]}
      />
      <P>An absent policy and a present policy are different commitments. The schema is strict: unknown fields are rejected.</P>

      <H2>On-chain records</H2>
      <Table
        head={["CONTRACT", "STORES", "KEY PROPERTIES"]}
        cols="minmax(130px,0.7fr) minmax(0,1.6fr) minmax(0,1.6fr)"
        rows={[
          [<Code key="1">VeridRegistry</Code>, "Receipt hash, task, policy, evidence root and count, result hash, validation status and result hash, anchorer address.", "Append-only. One record per execution key. Only allow-listed anchorers can write. Duplicate or conflicting writes revert."],
          [<Code key="2">VeridValidation</Code>, "Validator address and id, validator version hash, validation result hash, status, timestamp.", "Write-once per execution key. Only registered validators can write. Revoking a validator affects future records only."],
          [<Code key="3">VeridEscrow</Code>, "Payer, payee, amount, deadline, status per execution key.", "No admin. Releases only on Pass + anchor; refunds only on Fail or expiry."],
        ]}
      />
    </>
  );
}
