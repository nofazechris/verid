import { Callout, Code, CodeBlock, H1, H2, H3, P, Table, UL } from "@/components/docs";

export default function Validators() {
  return (
    <>
      <H1 kicker="GUIDES">Validators</H1>
      <P>
        A validator is the part of Verid that decides whether a result passes. It runs <b style={{ color: "#E8ECE9", fontWeight: 500 }}>on the Verid server</b>, over the evidence and result you recorded, and returns one of three outcomes. You cannot submit an outcome yourself: the API accepts a validator ID and runs it.
      </P>

      <H2>Outcomes</H2>
      <Table
        head={["OUTCOME", "MEANING", "EXECUTION BECOMES"]}
        cols="minmax(130px,0.7fr) minmax(0,2fr) minmax(0,1.2fr)"
        rows={[
          [<Code key="a">pass</Code>, "Every determinate check passed.", <Code key="a2">validated</Code>],
          [<Code key="b">fail</Code>, "At least one determinate check definitely failed.", <><Code key="b2">validation_failed</Code> (terminal)</>],
          [<Code key="c">inconclusive</Code>, "A check could not be decided (for example the evidence needed was missing or malformed).", <><Code key="c2">validation_failed</Code> (terminal)</>],
        ]}
      />
      <P>
        Only <Code>pass</Code> can lead to an anchor or a settlement. Fail and inconclusive are preserved exactly as produced, and can never be edited or replaced by a later run. Every result lists each individual check with whether it passed and whether it was determinate, so a reader can see what was and was not evaluated.
      </P>

      <H2>The built-in validator: research-validator</H2>
      <P>Version <Code>1.0.0</Code>. A deterministic structural check for research-style tasks that return a list of entries <Code>{`{ name, website, foundedYear, sources[] }`}</Code>. It makes no network requests.</P>
      <UL>
        <li>The result is an array of objects.</li>
        <li>Every entry has a name, an http/https website, an integer founding year and at least one source URL.</li>
        <li>Each founding year is strictly greater than the task’s <Code>foundedAfter</Code> parameter (default 2024).</li>
        <li>No duplicates, by normalized name or by website host.</li>
        <li>At least <Code>minimumResults</Code> qualifying entries (default 10).</li>
        <li>The evidence includes a <Code>tool_call</Code>, a <Code>tool_result</Code> and a <Code>result</Code> record.</li>
      </UL>
      <Callout title="WHAT IT DOES NOT CHECK">
        It does not confirm that any company exists, that a website is live, or that a founding year is true. Every result includes an explicit <Code>factual_claims_unverified</Code> check saying so. A pass means “complete, well-formed and consistent”, not “correct”.
      </Callout>

      <H2>Task parameters it reads</H2>
      <Table
        head={["PARAMETER", "DEFAULT", "NOTES"]}
        cols="minmax(150px,0.8fr) minmax(80px,0.5fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">parameters.minimumResults</Code>, "10", "Integer from 1 to 10,000."],
          [<Code key="2">parameters.foundedAfter</Code>, "2024", "Integer year from 1900 to 3000."],
        ]}
      />

      <H2>Where the outcome is recorded</H2>
      <UL>
        <li>In Verid’s database, with the full list of checks.</li>
        <li>As a commitment inside the receipt (<Code>validation.status</Code>, validator id and version, result hash).</li>
        <li>On Arc, in the registry anchor, and (when escrow is configured) as a write-once record in the <Code>VeridValidation</Code> contract written by a registered validator address. The escrow reads that record.</li>
      </UL>

      <H2>Your own validators: rule-based</H2>
      <P>
        You can define your own validator without hosting or uploading any code. You describe what a good result looks like as <b style={{ color: "#E8ECE9", fontWeight: 500 }}>rules</b> (data, not a program), and Verid evaluates them deterministically on its server. Create one in the dashboard under Validators → New validator, or with <Code>POST /validators</Code>. Then use it by ID: <Code>{`{ "executionId": "exe_…", "validatorId": "custom:<id>" }`}</Code>.
      </P>
      <CodeBlock title="EXAMPLE">{`POST /api/v1/validators
{
  "slug": "startup-list",
  "name": "Startup list checker",
  "rules": [
    { "type": "items", "path": "$", "min": { "param": "minimumResults", "default": 5 } },
    { "type": "required_fields", "path": "$[*]", "fields": ["name", "website"] },
    { "type": "field_format", "path": "$[*].website", "format": "http_url" },
    { "type": "unique", "path": "$[*].name" },
    { "type": "evidence", "types": ["tool_call", "tool_result", "result"] }
  ]
}`}</CodeBlock>

      <H3>Paths</H3>
      <P>
        <Code>$</Code> is the whole result, <Code>$.items</Code> a field, <Code>$[*]</Code> every element of a list, <Code>$[*].website</Code> a field of each element, <Code>$[0]</Code> a specific element. A path that does not exist is a failure, never a pass.
      </P>

      <H3>Rule types</H3>
      <Table
        head={["TYPE", "OPTIONS", "PASSES WHEN"]}
        cols="minmax(140px,0.8fr) minmax(0,1.4fr) minmax(0,1.6fr)"
        rows={[
          [<Code key="1">items</Code>, <><Code key="a">path</Code>, <Code key="b">min</Code>, <Code key="c">max</Code></>, "The list at the path has a length within the bounds."],
          [<Code key="2">required_fields</Code>, <><Code key="a">path</Code>, <Code key="b">fields[]</Code></>, "Every matched object has each field present and non-empty."],
          [<Code key="3">field_format</Code>, <><Code key="a">path</Code>, <Code key="b">format</Code></>, <>Every matched value fits the format: <Code key="f">non_empty_string</Code>, <Code key="g">http_url</Code>, <Code key="h">email</Code>, <Code key="i">iso_date</Code>, <Code key="j">integer</Code>, <Code key="k">number</Code>, <Code key="l">boolean</Code>, <Code key="m">non_empty_array</Code>.</>],
          [<Code key="4">number_range</Code>, <><Code key="a">path</Code>, <Code key="b">min</Code>, <Code key="c">max</Code>, <Code key="d">integer</Code></>, "Every matched value is a number within the bounds (and whole, if integer)."],
          [<Code key="5">one_of</Code>, <><Code key="a">path</Code>, <Code key="b">values[]</Code></>, "Every matched value is one of the listed strings, numbers or booleans."],
          [<Code key="6">unique</Code>, <Code key="a">path</Code>, "No two matched values are equal (text is compared trimmed and case-insensitively)."],
          [<Code key="7">evidence</Code>, <><Code key="a">types[]</Code>, <Code key="b">min</Code></>, "Each listed evidence type was recorded at least min times (default 1)."],
          [<Code key="8">evidence_count</Code>, <><Code key="a">min</Code>, <Code key="b">max</Code></>, "The number of evidence records is within the bounds."],
        ]}
      />
      <P>
        Any bound can be a number or <Code>{`{ "param": "name", "default": 10 }`}</Code>, which reads <Code>task.parameters.name</Code> so one validator can serve tasks with different thresholds. If a parameter is missing and has no default, the check is <Code>inconclusive</Code>, not a pass. Unknown keys and typos are rejected when you save, so a mistake can never silently weaken a validator. Limits: up to 50 rules, 20 KB, 10,000 values per rule.
      </P>

      <H3>Try before you save</H3>
      <P>
        The editor has a test panel, and <Code>POST /validators/test</Code> does the same over the API: send the rules, a sample result, optional evidence types and task parameters, and get back the status and every check with exactly which values failed (for example <Code>$[1].website</Code>). Nothing is stored.
      </P>

      <H3>Versions never change</H3>
      <P>
        Editing (<Code>PATCH /validators/:id</Code>) creates version N+1; earlier versions are untouched. Each validation records the validator ID and a version label such as <Code>3+2d9d6371b0a7</Code>, where the suffix is the start of the rules’ hash, so a receipt pins exactly which rules produced it. Use <Code>custom:startup-list</Code> for the latest version, or <Code>custom:startup-list@2</Code> to pin one.
      </P>

      <Callout title="WHO WROTE THE RULES MATTERS">
        With a workspace validator, the party who builds the agent can also write the rules that judge it. A pass then means “this result satisfies the rules its own author chose”, which is useful for catching mistakes and for audit trails, but it is not an independent check. Every result carries an explicit line saying the rules were written by the workspace, and the validator appears on receipts and public proof pages as <Code>custom:…</Code>. If you are a payer funding an escrow, read the validator’s rules before you rely on it.
      </Callout>

      <H2>Other things to know</H2>
      <UL>
        <li><b>Rules check structure and limits, not truth.</b> Every result includes a <Code>factual_claims_unverified</Code> line.</li>
        <li><b>Not possible yet:</b> checks that call external services, run your own code, or use an AI model as the judge. Those would need a different trust model and are not offered.</li>
        <li><b>A validator is a trusted party.</b> See the <a href="/docs/trust-model" style={{ color: "#4ADE80" }}>trust model</a>.</li>
        <li>List everything available, with your outcome history, using <Code>GET /validators</Code> or the Validators page.</li>
      </UL>
    </>
  );
}
