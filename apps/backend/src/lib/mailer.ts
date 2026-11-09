import type {Bindings} from '../types/env';

/** The Resend API origin every send goes to unless overridden. */
const RESEND_API_BASE_URL = 'https://api.resend.com';

/**
 * Resend's error name for a send whose `Idempotency-Key` another send is
 * still using.
 */
const CONCURRENT_IDEMPOTENT_REQUESTS = 'concurrent_idempotent_requests';

/**
 * The site's name, as the frontend's `<title>` gives it. Every name a mail
 * shows -- its sender, its subject prefix, its footer -- is built from this
 * one, so a rename can't leave them disagreeing.
 */
export const SITE_NAME = '地域クイズ最強位・新人王';

/**
 * The display name every mail is sent under, so an inbox shows the site
 * rather than a bare `no-reply@` address (#170). It is put together with
 * `MAIL_FROM_ADDRESS` here rather than written into that binding, which
 * stays the bare address whose domain the mail provider has verified.
 */
export const MAIL_FROM_NAME = `${SITE_NAME} エントリー`;

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  /** The plain-text alternative, for clients that don't render HTML. */
  text?: string;
  /**
   * Names this mail to the provider so that sending it again within 24
   * hours sends nothing (Resend's `Idempotency-Key`, 256 characters at
   * most). For a send that is retried after an answer that may have been
   * lost -- a 5xx or a network error, where the mail may have gone out
   * after all -- so the retry can't deliver it twice. A retry must send the
   * same body under the same key: Resend refuses a changed one (409
   * `invalid_idempotent_request`).
   */
  idempotencyKey?: string;
}

export interface MailSender {
  send(input: SendMailInput): Promise<void>;
}

/**
 * A send that did not go through: either the mail provider rejected it, in
 * which case `status` carries the provider's own answer, or the request got
 * no answer at all (a network error), in which case `status` is `undefined`
 * and the error `fetch` threw is the `cause`.
 *
 * Callers use it to tell a failure worth trying again later
 * (`isTransient()`) from a permanent rejection such as an invalid address.
 */
export class MailSendError extends Error {
  /**
   * The provider's name for the error, when its body gave one, or
   * `undefined`.
   */
  readonly code: string | undefined;

  constructor(
    /** The provider's HTTP status, or `undefined` for a network error. */
    readonly status: number | undefined,
    /**
     * How long the provider asked us to wait before retrying, in
     * milliseconds, or `undefined` when it said nothing.
     */
    readonly retryAfterMs?: number,
    options?: ErrorOptions & {
      /**
       * The provider's name for the error (Resend's `name`, e.g.
       * `concurrent_idempotent_requests`), when its body gave one.
       */
      code?: string;
    },
  ) {
    super(
      status === undefined
        ? 'Failed to send mail: network error'
        : `Failed to send mail: ${status}`,
      options,
    );
    this.code = options?.code;
    this.name = 'MailSendError';
  }

  /** Whether the provider throttled us, i.e. a retry may still succeed. */
  isRateLimited(): boolean {
    return this.status === 429;
  }

  /**
   * Whether the failure says nothing about the message itself, so the same
   * send may succeed later: a throttle (429), a fault on the provider's side
   * (5xx), a timeout (408), a send under the same `idempotencyKey` still
   * in flight, or a request that got no answer. Anything else -- an address
   * or a body the provider refuses -- would only be refused again.
   *
   * A 5xx or a network error does not prove the mail was *not* accepted
   * (the answer may have been lost on its way back), so a caller that tries
   * one again accepts that the recipient may, rarely, get it twice.
   */
  isTransient(): boolean {
    return (
      this.status === undefined ||
      this.isRateLimited() ||
      // A request the provider gave up waiting for says nothing about the
      // mail either.
      this.status === 408 ||
      // Another send under the same `idempotencyKey` is still in flight:
      // its own outcome isn't known yet, and Resend says to ask again
      // later. The other 409s (a changed body under a used key) would only
      // be refused again.
      (this.status === 409 && this.code === CONCURRENT_IDEMPOTENT_REQUESTS) ||
      (this.status >= 500 && this.status <= 599)
    );
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
 * The provider's name for the error a refused send answered with: the
 * `name` of Resend's JSON error body. Resend doesn't document the body's
 * shape, so anything else -- no body, not JSON, no string `name` -- yields
 * `undefined` rather than throwing.
 */
async function readErrorName(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return undefined;
    const name = (body as Record<string, unknown>).name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
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
    // The key travels as a header, not as part of the mail.
    const {idempotencyKey, ...mail} = input;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {}),
        },
        body: JSON.stringify({from: this.fromAddress, ...mail}),
      });
    } catch (error) {
      // `fetch` rejects (typically with a `TypeError`) when no answer came
      // back at all. Wrapped so that every failed send reaches the caller as
      // the one error type, which can tell this outage from a rejection.
      throw new MailSendError(undefined, undefined, {cause: error});
    }
    if (!res.ok) {
      throw new MailSendError(res.status, parseRetryAfterMs(res.headers), {
        code: await readErrorName(res),
      });
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
    `${MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`,
    baseUrl || undefined,
  );
}
