import { A } from "@/components/ui";
import { Callout, Code, CodeBlock, H1, H2, H3, P, Table, UL } from "@/components/docs";

export default function Agents() {
  return (
    <>
      <H1 kicker="GUIDES">Agents &amp; monitoring</H1>
      <P>
        In Verid, an <b style={{ color: "#E8ECE9", fontWeight: 500 }}>agent</b> is the name of a piece of your software that does work: a script, a web service, an LLM loop, a scheduled job. Verid never runs it. It runs wherever you run it, and each time it does a job it <i>reports the run</i> to Verid. The Agents page is where you see whether those agents are behaving.
      </P>

      <H2>Why register an agent at all?</H2>
      <UL>
        <li><b>Every run is attributed.</b> A receipt names the agent and its version, so a customer knows which software produced it.</li>
        <li><b>You get monitoring for free.</b> Health, pass rate, activity, and the reason for the last failure, built from the runs it reports.</li>
        <li><b>You do not have to create it by hand.</b> The SDK creates the agent on its first run. The dashboard’s “Add agent” is for when you want the record (and the connect code) before the code exists.</li>
      </UL>

      <H2>What an agent card tells you</H2>
      <Table
        head={["SHOWN", "MEANING"]}
        cols="minmax(150px,0.8fr) minmax(0,2fr)"
        rows={[
          ["Health", "A plain-language reading of recent runs. See below. It is not a score."],
          ["Runs / last 24h", "Total executions the agent has reported, and how many started in the last day."],
          ["Pass rate", "Share of the most recent finished runs (up to 10) that passed validation."],
          ["Last run", "When it last reported. An agent you expect to run daily that shows “3 days ago” needs attention."],
          ["Stuck runs", "Runs that started but made no progress for over an hour: the agent probably hung."],
        ]}
      />

      <H3>How health is decided</H3>
      <Table
        head={["HEALTH", "WHEN"]}
        cols="minmax(130px,0.6fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">no_runs</Code>, "The agent has never reported a run."],
          [<Code key="2">healthy</Code>, "Recent finished runs are passing (or there are none finished yet and none failed)."],
          [<Code key="3">degraded</Code>, "Fewer than 80% of the last 10 finished runs passed, or, with fewer than 3 finished runs, one has failed so far."],
          [<Code key="4">failing</Code>, "The last 3 finished runs all failed."],
        ]}
      />
      <P>
        A run counts as <i>failed</i> in two different ways, and the dashboard tells them apart: a <b>validation failure</b> (the agent produced a result but the validator rejected it) or an <b>agent error</b> (the agent crashed or gave up, so there was no result to validate). Health is computed only from recorded runs and validations; nothing is sampled or guessed.
      </P>

      <H2>Reporting a crash</H2>
      <P>
        If your agent throws an exception, the run should not just disappear. The SDK handles this: when the function you pass to <Code>verid.run</Code> throws, it records the execution as <Code>failed</Code> with the error message and re-throws. If you use plain HTTP, call:
      </P>
      <CodeBlock>{`POST /api/v1/executions/:id/fail
{ "reason": "upstream API returned 500" }`}</CodeBlock>
      <P>This is only allowed before validation (a validated run cannot later be called failed), it is terminal, and the reason shows in the agent’s “Last failure” card.</P>

      <H2>Archive vs delete</H2>
      <Table
        head={["", "ARCHIVE", "DELETE"]}
        cols="minmax(110px,0.5fr) minmax(0,1.5fr) minmax(0,1.5fr)"
        rows={[
          ["Keeps history", "Yes. Every run, receipt, anchor and escrow stays exactly as it was.", "n/a"],
          ["Allowed when", "Always.", "Only if the agent has never run."],
          ["Why", "For an agent you no longer use.", "For a record you created by mistake."],
        ]}
      />
      <Callout title="WHY AN AGENT WITH RUNS CANNOT BE DELETED">
        Its runs are a permanent record that other people may be relying on: receipts anchored on a blockchain, public proof links, and escrows that paid out. Deleting the agent would orphan them. The API answers <Code>409</Code> with an explanation, and the dashboard offers Archive instead.
      </Callout>

      <H2>Connecting an agent</H2>
      <P>
        Open the agent in the dashboard and choose the <b>Connect</b> tab: it shows the install command and the code for your server and this agent’s handle, and watches for the first run. The same code is in <A href="/docs/sdk" css="color:#4ADE80">SDK</A>, and a complete working agent is in <A href="/docs/examples" css="color:#4ADE80">Examples</A>.
      </P>
      <H3>API</H3>
      <Table
        head={["CALL", "WHAT"]}
        cols="minmax(210px,1fr) minmax(0,2fr)"
        rows={[
          [<Code key="1">GET /agents</Code>, "Each agent with a compact monitoring summary."],
          [<Code key="2">GET /agents/:id</Code>, "One agent with full monitoring: health, 14-day series, average duration, last failure, recent runs."],
          [<Code key="3">PATCH /agents/:id</Code>, <>Edit details, or archive/reactivate with <Code key="a">{`{ "status": "inactive" | "active" }`}</Code>.</>],
          [<Code key="4">DELETE /agents/:id</Code>, "Delete an agent that has never run; 409 otherwise."],
          [<Code key="5">POST /executions/:id/fail</Code>, "Record that the agent crashed or gave up."],
        ]}
      />
    </>
  );
}
