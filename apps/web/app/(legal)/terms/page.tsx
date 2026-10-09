import { Callout, Code, H1, H2, P, UL } from "@/components/docs";
import { CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata = { title: "Terms of Service — Verid" };

const B = ({ children }: { children: React.ReactNode }) => <b style={{ color: "#E8ECE9", fontWeight: 500 }}>{children}</b>;

export default function Terms() {
  return (
    <>
      <H1 kicker={`LAST UPDATED ${LEGAL_UPDATED.toUpperCase()}`}>Terms of Service</H1>
      <P>These terms govern your use of Verid, a service that records what automated software (&ldquo;agents&rdquo;) did, checks the result against rules, and publishes a verifiable fingerprint on the Arc blockchain. By creating an account or using the API you agree to them.</P>

      <H2>1. Your account</H2>
      <UL>
        <li>You must give a real email address and keep your sign-in details and API keys secret. You are responsible for what happens under your account and your API keys. An API key is shown once; if it leaks, revoke it in Settings.</li>
        <li>You must be old enough to enter a binding contract where you live, or be acting for an organisation that is.</li>
      </UL>

      <H2>2. What Verid does, and does not do</H2>
      <P>Verid <B>proves integrity, not truth</B>. A receipt shows what was recorded, what rules were applied, what the verdict was, and that a fingerprint of it was published at a point in time. It does not show that an agent&rsquo;s output is correct, lawful or safe. Rules you write yourself (validators) check structure and limits that you chose. Do not present a Verid receipt as more than that.</P>

      <H2>3. Your content</H2>
      <UL>
        <li>You keep ownership of what you send to Verid (tasks, evidence, results, rules). You give us the right to store, process and display it as needed to run the service for you.</li>
        <li><B>Do not record secrets or personal data as evidence.</B> Evidence content is stored by Verid and shown to members of your workspace. Only hashes go on the blockchain, but you should still send only what a run needs to be checkable.</li>
        <li>You must have the right to send whatever you send, and it must not break the law or anyone&rsquo;s rights.</li>
      </UL>

      <H2>4. Acceptable use</H2>
      <UL>
        <li>No attempts to break, overload, probe or bypass the service, its rate limits or another workspace&rsquo;s access.</li>
        <li>No use that is unlawful, deceptive, or that presents fabricated runs as real ones.</li>
        <li>No reselling access in a way that hides who is responsible for the account.</li>
      </UL>

      <H2>5. Blockchain and escrow</H2>
      <UL>
        <li>Anchoring publishes receipt fingerprints to a public blockchain. <B>Published records are permanent and cannot be deleted or changed by anyone, including us.</B> They contain hashes, not your content.</li>
        <li>Where the service is connected to a test network, the tokens have no value and records may be reset. Where it is connected to a main network, transactions use real value and cannot be reversed.</li>
        <li>Escrow is a smart contract that holds USDC and pays out or refunds according to its fixed rules. You use it at your own risk: smart contracts can contain bugs, networks can fail, and wallet mistakes cannot be undone. Nothing here is financial, investment, legal or tax advice. You are responsible for your own wallet, keys and transactions.</li>
      </UL>

      <H2>6. Availability and changes</H2>
      <P>We aim to keep the service running but do not promise it will be uninterrupted or error-free. Features may change or be removed. Anchoring depends on third-party networks outside our control.</P>

      <H2>7. Ending your use</H2>
      <P>You can stop using Verid at any time and ask us to delete your account (see Privacy). We may suspend or end access if you break these terms or put the service or others at risk. Anything already published on a blockchain remains there.</P>

      <H2>8. Disclaimer and limits</H2>
      <P>The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind to the extent the law allows. To the extent the law allows, we are not liable for indirect or consequential loss, lost profits or lost data, or for loss from blockchain, escrow or wallet use, and our total liability for any claim is limited to the amount you paid us for the service in the three months before the claim (which may be nothing while the service is free). Nothing in these terms limits liability that cannot lawfully be limited.</P>

      <H2>9. Changes to these terms</H2>
      <P>We may update these terms. If a change is significant we will tell you in the app or by email. Using the service after a change means you accept it.</P>

      <H2>10. Contact</H2>
      <P>{CONTACT_EMAIL ? <>Questions about these terms: <Code>{CONTACT_EMAIL}</Code>.</> : "Questions about these terms: use the contact address published on this website."}</P>

      <Callout title="IN PLAIN WORDS">
        Keep your keys safe, do not put secrets in evidence, remember a receipt proves what was recorded and checked rather than that it is true, and know that anything anchored on-chain is permanent.
      </Callout>
    </>
  );
}
