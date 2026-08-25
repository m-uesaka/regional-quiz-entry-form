export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

export interface MailSender {
  send(input: SendMailInput): Promise<void>;
}

/**
 * A send the mail provider rejected, carrying the provider's own answer so
 * callers can tell a retryable throttle (HTTP 429) from a permanent
 * rejection such as an invalid address.
 */
export class MailSendError extends Error {
  constructor(
    readonly status: number,
    /**
     * How long the provider asked us to wait before retrying, in
     * milliseconds, or `undefined` when it said nothing.
     */
    readonly retryAfterMs?: number,
  ) {
    super(`Failed to send mail: ${status}`);
    this.name = 'MailSendError';
  }

  /** Whether the provider throttled us, i.e. a retry may still succeed. */
  isRateLimited(): boolean {
    return this.status === 429;
  }
}

/**
 * Reads a `Retry-After`-style header into milliseconds.
 *
 * `Retry-After` is either a delay in seconds or an HTTP date; Resend also
 * answers a rate limit with `ratelimit-reset` in seconds. Anything else
 * (missing, blank, unparsable) yields `undefined` so the caller falls back
 * to its own backoff.
 */
function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after') ?? headers.get('ratelimit-reset');
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) {
    return undefined;
  }
  return Math.max(0, at - Date.now());
}

/**
 * Sends mail via the Resend HTTP API.
 *
 * Resend is chosen because it's callable over `fetch` (no Node.js-only
 * SDK) and supports sender domain verification, both required to run on
 * Cloudflare Workers. Tasks 3-4, 5-5, and 6-3 depend only on the
 * `MailSender` interface above, not on Resend specifically.
 */
export class ResendMailSender implements MailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(input: SendMailInput): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({from: this.fromAddress, ...input}),
    });
    if (!res.ok) {
      throw new MailSendError(res.status, parseRetryAfterMs(res.headers));
    }
  }
}
