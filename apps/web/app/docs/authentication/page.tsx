import { Callout, Code, CodeBlock, H1, H2, P } from "@/components/docs";

export default function Authentication() {
  return (
    <>
      <H1 kicker="GET STARTED">Authentication</H1>
      <P>The API accepts two kinds of credentials. Every request is scoped to exactly one workspace, and that scope is enforced on the server.</P>

      <H2>API keys</H2>
      <P>
        For services and scripts. Create one in Settings → API Keys (admins only). The full key is shown once; Verid stores only a hash and cannot recover it.
      </P>
      <CodeBlock>{`authorization: Bearer verid_xxxxxxxx_<43 characters>`}</CodeBlock>
      <ul style={{ margin: 0, paddingLeft: 20, color: "#9BA39E", fontSize: 14.5, lineHeight: 1.8, maxWidth: 760 }}>
        <li>Bound to one workspace. It cannot read or write anything in another.</li>
        <li><Code>developer</Code> keys can read and write; <Code>viewer</Code> keys are read-only. Keys are never admin and can never create keys or manage members.</li>
        <li>Optional expiry. Revoking a key takes effect immediately.</li>
        <li>A request with an invalid bearer token is rejected outright; it never falls back to a browser session.</li>
      </ul>

      <H2>Browser sessions</H2>
      <P>
        The dashboard uses an encrypted, httpOnly session cookie. State-changing requests must come from the app’s own origin (CSRF protection). Programmatic clients should use API keys.
      </P>

      <H2>Roles</H2>
      <P><Code>viewer</Code> reads. <Code>developer</Code> creates agents, executions, evidence, validations, receipts and anchors. <Code>admin</Code> manages API keys. <Code>owner</Code> owns the workspace. Hiding a button in the UI never grants or removes access; the server decides.</P>

      <H2>Idempotency and rate limits</H2>
      <P>
        Send <Code>Idempotency-Key</Code> (8–200 characters) on creates and evidence writes. The same key with the same body replays the original response (<Code>Idempotent-Replay: true</Code>); the same key with a different body is rejected with <Code>422</Code>. Rate-limited requests return <Code>429</Code> with <Code>Retry-After</Code>.
      </P>
      <Callout title="ERRORS">
        Every error is JSON: <Code>{`{"error":{"code":"…","message":"…"}}`}</Code> with a stable code: invalid_request, unauthenticated, forbidden, email_not_verified, not_found, conflict, invalid_state, idempotency_conflict, payload_too_large, rate_limited, unavailable, internal.
      </Callout>
    </>
  );
}
