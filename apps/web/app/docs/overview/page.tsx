import { A } from "@/components/ui";
import { Callout, Code, H1, H2, H3, OL, P, Table, UL } from "@/components/docs";

export default function Overview() {
  return (
    <>
      <H1 kicker="OVERVIEW">What is Verid?</H1>
      <P>
        Verid is <b style={{ color: "#E8ECE9", fontWeight: 500 }}>proof of work for AI agents</b>. When an agent does a job, Verid records what it did, has a validator check the result against written rules, produces a portable receipt, and publishes a fingerprint of that receipt on the Arc blockchain. Anyone, including people who do not trust you or Verid, can later check that the receipt is genuine and unchanged.
      </P>

      <H2>A complete example, start to finish</H2>
      <P>
        Priya runs a small business that sells market-research reports written by an AI agent. Her customer, Acme, pays 25 USDC per report. Acme’s question is fair: <i>“How do I know your agent actually did the work, and that the report meets what I asked for?”</i> Priya’s answer used to be “trust me”. With Verid it is a link.
      </P>
      <Table
        head={["STEP", "WHAT HAPPENS", "WHERE YOU SEE IT"]}
        cols="minmax(40px,0.2fr) minmax(0,2fr) minmax(0,1.2fr)"
        rows={[
          ["1", <>Priya adds about forty lines to her agent (<A key="a" href="/docs/examples" css="color:#4ADE80">Examples</A>). She defines what a good report looks like as validator rules: at least 10 companies, each with a name, a website and a source, no duplicates.</>, "Validators page"],
          ["2", "Acme funds a 25 USDC escrow for the job from their own wallet, naming Priya as the payee. The money is locked by a smart contract; neither side can touch it.", "Execution → Settlement panel"],
          ["3", "Priya’s agent runs. Each search it makes and each answer it gets is sent to Verid as evidence, hashed and timestamped by Verid’s server.", "Execution → Evidence"],
          ["4", "The agent finishes. Verid’s server runs the validator over the result and the evidence and decides pass or fail. Priya’s code cannot decide that itself.", "Execution → Validator"],
          ["5", "On a pass, Verid creates a receipt and writes its fingerprints to the Arc blockchain. The receipt contains no report text, only hashes.", "Receipts, Arc anchor"],
          ["6", "Priya sends Acme one link. Acme sees the validator’s verdict and the on-chain anchor without logging in, and can re-check it with the open-source CLI without trusting Verid at all.", "/proof/<receipt id>"],
          ["7", "Anyone presses Settle. The escrow contract checks for a recorded Pass and the anchor, then pays Priya 25 USDC. Had validation failed, or no proof appeared before the deadline, Acme would get the money back automatically.", "Settlements page"],
        ]}
      />
      <P>
        Neither side had to trust the other, and neither had to trust Verid with their money. What Verid contributed is the part nobody else can: a neutral record of what was checked, tied to a blockchain.
      </P>

      <H2>The problem it solves</H2>
      <P>
        Agents are starting to do work for other people: research, code changes, support, data tasks. The person who asked for the work, or pays for it, usually has only the agent’s word that it was done properly. A log file can be edited after the fact. A dashboard can show a green tick without saying what was checked. There is no neutral record that a third party can rely on.
      </P>
      <P>
        Verid is that record. It does not make agents more accurate. It makes “this agent ran this task, produced this result, and this check passed” something a stranger can verify instead of something they have to believe.
      </P>

      <H2>Who uses it, and for what</H2>
      <Table
        head={["WHO", "WHAT THEY DO WITH VERID"]}
        cols="minmax(150px,0.7fr) minmax(0,2fr)"
        rows={[
          ["Agent builders", <>Connect their agent to Verid so every run produces a receipt. This is the integration work. See <A href="/docs/integrate" css="color:#4ADE80">Connect your agent</A>.</>],
          ["Their customers or counterparties", "Open a receipt link and see, without an account, what was committed, which validator ran, and whether it is anchored on Arc. Optionally lock payment in escrow that releases only when the proof exists."],
          ["Auditors and skeptics", <>Download the receipt and verification bundle and run <Code>verid receipt verify</Code> against the chain, without using Verid’s servers at all.</>],
        ]}
      />

      <H2>What happens when you connect an agent</H2>
      <P>You add a few API calls around the work your agent already does. Nothing about how the agent thinks or acts changes.</P>
      <OL>
        <li><b>Start.</b> Your code asks Verid to create an <i>execution</i> for a task (“find 10 AI startups founded after 2024”). Verid hashes the task and returns an execution ID.</li>
        <li><b>Record.</b> As the agent works, your code sends each tool call and tool result as <i>evidence</i>. Verid hashes each record, stamps it with the server time, and keeps the content private.</li>
        <li><b>Complete.</b> Your code sends the final result. Verid hashes it and seals the evidence into a single <i>evidence root</i> that also fixes the number and order of records.</li>
        <li><b>Validate.</b> A validator running on the Verid server checks the result and evidence against its published rules and returns pass, fail or inconclusive. You cannot supply the outcome yourself.</li>
        <li><b>Receipt.</b> Verid generates a receipt: a small JSON document of fingerprints (task, policy, evidence, result, validation).</li>
        <li><b>Anchor.</b> Verid publishes the receipt’s fingerprints in a transaction on Arc through the <Code>VeridRegistry</Code> contract. Raw data never goes on-chain, only hashes.</li>
        <li><b>Verify.</b> Anyone with the receipt and bundle recomputes the hashes and reads the chain. If everything matches, the record is genuine and unchanged.</li>
        <li><b>Optional: get paid on proof.</b> A payer locks USDC in the <Code>VeridEscrow</Code> contract. It pays the agent’s owner only once the validation passed and the receipt is anchored, and refunds the payer if validation fails or the deadline passes.</li>
      </OL>

      <H2>The pieces</H2>
      <Table
        head={["PIECE", "WHAT IT IS", "WHERE"]}
        cols="minmax(130px,0.7fr) minmax(0,2fr) minmax(130px,0.9fr)"
        rows={[
          ["REST API", "The one way into Verid. Everything the dashboard does goes through it.", <Code key="a">/api/v1</Code>],
          ["Dashboard", "Web app: workspaces, agents, executions, receipts, API keys, settlement.", "this app"],
          ["Validators", "Server-side checks that decide pass, fail or inconclusive. One is built in; you can define your own as rules.", <A key="v" href="/docs/validators" css="color:#4ADE80">Validators</A>],
          ["Receipts", "Portable JSON of fingerprints plus an optional verification bundle.", <A key="r" href="/docs/verification" css="color:#4ADE80">Verification</A>],
          ["Arc contracts", "VeridRegistry (anchors), VeridValidation (on-chain validation records), VeridEscrow (USDC settlement).", <A key="c" href="/docs/escrow" css="color:#4ADE80">Escrow</A>],
          ["CLI", "Independent verifier that reads the chain directly.", <A key="cli" href="/docs/cli" css="color:#4ADE80">CLI</A>],
          ["SDK", "TypeScript and Python clients: one verid.run() call records, validates and anchors a run. Hosted by your server.", <A key="s" href="/docs/sdk" css="color:#4ADE80">SDK</A>],
        ]}
      />

      <H2>What Verid proves, and what it does not</H2>
      <P>Verid proves <i>integrity</i>: that what you hold matches what was committed, at a time that can be checked, by parties that are named. It does not prove <i>truth</i>.</P>
      <H3>It does show</H3>
      <UL>
        <li>The task, evidence, result and validation outcome have not changed since they were committed.</li>
        <li>A named validator, at a named version, returned a named outcome.</li>
        <li>Those commitments were published on Arc by an authorized address, in a specific block.</li>
        <li>If an escrow was used, whether it released or refunded, as recorded on-chain.</li>
      </UL>
      <H3>It does not show</H3>
      <UL>
        <li>That the agent’s result is factually correct. The built-in research validator checks structure, completeness and consistency, and says in its own output that it did not check facts.</li>
        <li>That a tool call really happened or that an external API told the truth. Evidence supplied by the agent is untrusted until checked some other way.</li>
        <li>That the validator is independent or right. A validation is a recorded claim by a designated validator.</li>
        <li>That an agent followed its policy. A policy hash proves which rules were declared, not that they were obeyed.</li>
      </UL>
      <Callout title="READ THIS BEFORE RELYING ON A RECEIPT">
        The <A href="/docs/trust-model" css="color:#4ADE80">trust model</A> lists exactly which parties you still have to trust (anchorers, validators, your RPC) and why. Verid is built to never claim more than it checks.
      </Callout>

      <H2>Where to go next</H2>
      <UL>
        <li>Try it in five minutes: <A href="/docs" css="color:#4ADE80">Quickstart</A>.</li>
        <li>Run a real, deployable research agent: <A href="/docs/examples" css="color:#4ADE80">Examples</A>, then wire up your own with the <A href="/docs/sdk" css="color:#4ADE80">SDK</A>.</li>
        <li>See how agents are monitored: <A href="/docs/agents" css="color:#4ADE80">Agents &amp; monitoring</A>.</li>
        <li>Run the whole stack on your machine: <A href="/docs/self-hosting" css="color:#4ADE80">Self-hosting &amp; configuration</A>.</li>
      </UL>
    </>
  );
}
