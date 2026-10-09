import { Callout, Code, H1, H2, P, Table, UL } from "@/components/docs";
import { CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata = { title: "Privacy Policy — Verid" };

const B = ({ children }: { children: React.ReactNode }) => <b style={{ color: "#E8ECE9", fontWeight: 500 }}>{children}</b>;

export default function Privacy() {
  return (
    <>
      <H1 kicker={`LAST UPDATED ${LEGAL_UPDATED.toUpperCase()}`}>Privacy Policy</H1>
      <P>This explains what Verid stores about you and your work, who else handles it, and what you can ask us to do. Verid is built to keep as little as it can.</P>

      <H2>What we collect</H2>
      <Table
        head={["WHAT", "WHY"]}
        cols="minmax(0,1.3fr) minmax(0,1.7fr)"
        rows={[
          ["Email address, and your name if Google provides it", "To create your account, verify your email and send password-reset links."],
          ["A hash of your password (never the password itself)", "To sign you in. Stored with a slow, salted hash (scrypt)."],
          ["Workspace data you create: workspace and member names, API keys (stored only as hashes), agents, validators and policies", "To run the service for you."],
          ["Run data you send: tasks, evidence, results, verdicts, receipts, settlement records and an audit log of actions", "To record, validate and let you verify your agents' work. Evidence content is visible to members of your workspace."],
          ["Technical data: your IP address (used for rate limiting and abuse prevention) and standard server logs from our hosting provider", "To keep the service secure and working."],
        ]}
      />
      <P>We do not run advertising or analytics trackers. We set only the cookies the app needs to keep you signed in and to protect against cross-site requests; you cannot use the signed-in app without them.</P>

      <H2>What goes on the blockchain</H2>
      <P>When a run passes and is anchored, a <B>fingerprint (hash)</B> of the receipt is published on the Arc blockchain, together with timestamps and identifiers. A hash does not reveal your data, and your tasks, evidence and results are never published. Because a blockchain is public and permanent, <B>what is published cannot be deleted</B>, even if you delete your account. Do not put personal data into anything that is meant to be anchored.</P>

      <H2>Who else handles data</H2>
      <UL>
        <li><B>Database hosting:</B> your data is stored in a managed Postgres database (Neon).</li>
        <li><B>Application hosting:</B> the service runs at a cloud hosting provider, which sees requests and logs.</li>
        <li><B>Email:</B> verification and reset emails are sent through Resend.</li>
        <li><B>Google sign-in:</B> if you choose it, Google tells us your email address, name and whether the address is verified. We do not receive your Google password.</li>
        <li><B>Fonts:</B> pages load fonts from Google Fonts, which means your browser contacts Google.</li>
        <li><B>Blockchain network:</B> as described above.</li>
      </UL>
      <P>We do not sell your data. We share it only with the services above to run Verid, or where the law requires it.</P>

      <H2>How long we keep it</H2>
      <P>While your account exists. When you ask us to delete your account we delete your account and workspace data from our database, except what we must keep for security or legal reasons and anything already published on a blockchain.</P>

      <H2>Your choices</H2>
      <UL>
        <li>Ask to see, correct, export or delete your data. Account deletion is handled by request for now (see Contact).</li>
        <li>Revoke API keys at any time in Settings.</li>
        <li>Depending on where you live you may have further rights, for example to object to processing or complain to a data protection authority.</li>
      </UL>

      <H2>Security</H2>
      <P>Sessions are encrypted and sent over HTTPS, API keys are stored hashed, workspaces are isolated from each other, and requests are rate limited. No system is perfectly secure; if we learn of a breach that affects you we will tell you.</P>

      <H2>Changes and contact</H2>
      <P>We may update this policy and will say so in the app or by email if the change matters. {CONTACT_EMAIL ? <>Contact us at <Code>{CONTACT_EMAIL}</Code> with any request or question.</> : "Use the contact address published on this website for any request or question."}</P>

      <Callout title="IN PLAIN WORDS">
        We keep your account details and the runs you send. Only hashes go on-chain, and those cannot be removed. We do not track you for advertising.
      </Callout>
    </>
  );
}
