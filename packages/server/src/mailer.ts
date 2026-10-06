export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * No SDK dependency: it is a single authenticated POST. `from` must be an address on a
 * domain verified in Resend. The API key is read by the caller from the environment and is
 * never logged.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly opts: { apiKey: string; from: string; fetch?: typeof fetch; endpoint?: string; retryDelayMs?: number },
  ) {
    if (!opts.apiKey) throw new Error("ResendMailer requires an API key");
    if (!opts.from) throw new Error("ResendMailer requires a from address");
  }

  /**
   * Sends with up to 3 attempts. Network errors, HTTP 429 and 5xx are retried with a short backoff (a single DNS
   * or connection blip must not mean "no verification email"); other rejections (bad key, bad sender, bad
   * recipient) fail immediately because retrying cannot help.
   */
  async send(mail: Mail): Promise<void> {
    const f = this.opts.fetch ?? fetch;
    const attempts = 3;
    let last: Error = new Error("email not sent");
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, this.opts.retryDelayMs ?? 400 * i));
      let res: Response;
      try {
        res = await f(this.opts.endpoint ?? "https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from: this.opts.from, to: [mail.to], subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        last = new Error(`could not reach Resend (${(e as Error).message})`);
        continue;
      }
      if (res.ok) return;
      // Include the status but never the request (it contains the recipient and a token link).
      last = new Error(`Resend rejected the email (HTTP ${res.status})`);
      if (res.status !== 429 && res.status < 500) throw last;
    }
    throw last;
  }
}

/** Dev mailer: prints to the server console and keeps an in-memory outbox. NEVER use in production. */
export class ConsoleMailer implements Mailer {
  readonly outbox: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.outbox.push(mail);
    if (this.outbox.length > 50) this.outbox.shift();
    console.log(`\n[verid:mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
  }
}

/** Test mailer: records mail, optionally failing. */
export class MemoryMailer implements Mailer {
  readonly outbox: Mail[] = [];
  failWith: Error | null = null;
  async send(mail: Mail): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.outbox.push(mail);
  }
  /** The most recent link in the most recent mail to `to`. */
  lastLink(to: string): string | undefined {
    const m = [...this.outbox].reverse().find((x) => x.to === to);
    return m ? /https?:\/\/\S+/.exec(m.text)?.[0] : undefined;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function verifyEmailMail(to: string, link: string): Mail {
  return {
    to,
    subject: "Verify your email for Verid",
    text: `Welcome to Verid.\n\nConfirm your email address to finish setting up your account:\n${link}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email.`,
    html: `<p>Welcome to Verid.</p><p>Confirm your email address to finish setting up your account:</p><p><a href="${esc(link)}">Verify email</a></p><p>This link expires in 24 hours. If you didn't create an account, ignore this email.</p>`,
  };
}

export function resetPasswordMail(to: string, link: string): Mail {
  return {
    to,
    subject: "Reset your Verid password",
    text: `We received a request to reset your Verid password.\n\nChoose a new password:\n${link}\n\nThis link expires in 30 minutes and can be used once. If you didn't ask for this, ignore this email — your password won't change.`,
    html: `<p>We received a request to reset your Verid password.</p><p><a href="${esc(link)}">Choose a new password</a></p><p>This link expires in 30 minutes and can be used once. If you didn't ask for this, ignore this email — your password won't change.</p>`,
  };
}
