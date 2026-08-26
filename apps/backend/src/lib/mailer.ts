import type {Bindings} from '../types/env';

/** The Resend API origin every send goes to unless overridden. */
const RESEND_API_BASE_URL = 'https://api.resend.com';

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
  private readonly baseUrl: string;

  /**
   * @param apiKey The Resend API key.
   * @param fromAddress The "From" address every send goes out as.
   * @param baseUrl The API origin to post to. Only the end-to-end tests
   *     pass this, pointing the sender at a local stub so a test run
   *     neither needs a real API key nor delivers mail; production leaves
   *     it at Resend's own origin.
   */
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    baseUrl: string = RESEND_API_BASE_URL,
  ) {
    // A configured origin may or may not carry a trailing slash, and
    // `https://api.resend.com//emails` is not the same path to Resend.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async send(input: SendMailInput): Promise<void> {
    const res = await fetch(`${this.baseUrl}/emails`, {
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

/**
 * Builds the mail sender the app sends through, from the Worker bindings.
 *
 * Every caller goes through this rather than constructing
 * `ResendMailSender` directly, so that `MAIL_API_BASE_URL` — the binding
 * the end-to-end tests point at their own stub — takes effect everywhere
 * mail is sent, not just where a test happened to look.
 * @param env The Worker bindings.
 */
export function createMailSender(env: Bindings): MailSender {
  // An unset binding arrives as `undefined`, and a blank one as an empty
  // string; neither is a usable origin, so both fall back to Resend.
  const baseUrl = env.MAIL_API_BASE_URL?.trim();
  return new ResendMailSender(
    env.MAIL_API_KEY,
    env.MAIL_FROM_ADDRESS,
    baseUrl || undefined,
  );
}
