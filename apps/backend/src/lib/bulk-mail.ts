import {MailSendError, type MailSender, type SendMailInput} from './mailer';

// Rate control for a bulk send: at most `MAIL_BATCH_SIZE` messages are in
// flight at once, and consecutive batches are spaced by
// `MAIL_BATCH_INTERVAL_MS`. Mail providers rate-limit by requests per
// second, so firing a whole tournament's worth of `send()` calls at once
// would have the tail of them rejected. The batch size also stays under the
// number of simultaneous outbound connections a Worker invocation may hold
// open, past which the extra sends would only queue anyway.
export const MAIL_BATCH_SIZE = 5;
export const MAIL_BATCH_INTERVAL_MS = 1000;

// The batching above only paces this one call, while the provider's rate
// limit is shared by the whole team: another bulk send, or a verification
// or password-reset mail, can run at the same time and push the aggregate
// over the limit. A throttled send is therefore retried instead of being
// recorded as a permanently failed recipient, waiting as long as the
// provider asked (`Retry-After`) or, failing that, an exponential backoff.
// The retries are bounded so one sustained outage can't keep a background
// send alive indefinitely.
export const MAIL_MAX_RETRIES = 3;
export const MAIL_RETRY_BASE_DELAY_MS = 1000;
/** Cap on a single wait, so an absurd `Retry-After` can't stall the run. */
export const MAIL_RETRY_MAX_DELAY_MS = 30_000;

export interface BulkMailContent {
  subject: string;
  html: string;
}

export interface BulkMailOptions {
  /** Messages per batch; must be a positive integer. */
  batchSize?: number;
  intervalMs?: number;
  /** Extra attempts after a throttled send; must not be negative. */
  maxRetries?: number;
  /** First backoff wait when the provider names no `Retry-After`. */
  retryBaseDelayMs?: number;
}

export interface BulkMailResult {
  sent: number;
  /** The recipients whose send was rejected, in the given order. */
  failed: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * How long to wait before retrying `error`, or `null` when it must not be
 * retried.
 * @param error The rejection the mail provider produced.
 * @param attempt The 0-based number of attempts already made.
 * @param baseDelayMs The backoff used when the provider names no delay.
 */
function retryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
): number | null {
  if (!(error instanceof MailSendError) || !error.isRateLimited()) {
    return null;
  }
  // The provider's own answer wins; the exponential backoff is only the
  // fallback for a 429 that carries no `Retry-After`.
  const delayMs = error.retryAfterMs ?? baseDelayMs * 2 ** attempt;
  return Math.min(delayMs, MAIL_RETRY_MAX_DELAY_MS);
}

/**
 * Sends one message, retrying while the provider answers with a throttle.
 *
 * Rethrows the last rejection once the retries are exhausted, or straight
 * away for anything that isn't a throttle, so the caller can record the
 * recipient as failed.
 */
async function sendWithRetry(
  mailer: MailSender,
  input: SendMailInput,
  maxRetries: number,
  baseDelayMs: number,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await mailer.send(input);
      return;
    } catch (error) {
      const delayMs =
        attempt < maxRetries ? retryDelayMs(error, attempt, baseDelayMs) : null;
      if (delayMs === null) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

/**
 * Sends the same message to every recipient, one message per recipient, in
 * rate-controlled batches.
 *
 * Each recipient is mailed individually so no one sees anybody else's
 * address. A recipient the mail provider rejects is collected into
 * `failed` instead of aborting the run, so one bad address can't stop the
 * rest of a tournament from being notified. A send the provider merely
 * throttled (HTTP 429) is retried with backoff first, since that says
 * nothing about the address.
 * @param mailer The mail sender to send through.
 * @param recipients The addresses to mail; duplicates are mailed twice, so
 *     de-duplicate before calling.
 * @param content The subject and HTML body every recipient receives.
 * @param options Overrides for the batch size, inter-batch wait, and retry
 *     behaviour.
 * @throws RangeError If `options.batchSize` is not a positive integer, or
 *     `options.maxRetries` is not a non-negative integer.
 */
export async function sendBulkMail(
  mailer: MailSender,
  recipients: readonly string[],
  content: BulkMailContent,
  options: BulkMailOptions = {},
): Promise<BulkMailResult> {
  const batchSize = options.batchSize ?? MAIL_BATCH_SIZE;
  const intervalMs = options.intervalMs ?? MAIL_BATCH_INTERVAL_MS;
  const maxRetries = options.maxRetries ?? MAIL_MAX_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? MAIL_RETRY_BASE_DELAY_MS;

  // A batch size of 0 (or a fractional/negative one) would leave the loop
  // below never advancing `start`, i.e. an infinite send loop, so reject it
  // up front rather than hanging the caller.
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError(
      `batchSize must be a positive integer, got ${batchSize}`,
    );
  }
  // A fractional or negative retry budget would make the `attempt <
  // maxRetries` comparison below silently mean something other than "this
  // many extra tries", so reject it rather than guess.
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError(
      `maxRetries must be a non-negative integer, got ${maxRetries}`,
    );
  }

  let sent = 0;
  const failed: string[] = [];

  for (let start = 0; start < recipients.length; start += batchSize) {
    if (start > 0) {
      await sleep(intervalMs);
    }

    const batch = recipients.slice(start, start + batchSize);
    const results = await Promise.allSettled(
      batch.map(to =>
        sendWithRetry(mailer, {to, ...content}, maxRetries, retryBaseDelayMs),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sent++;
        return;
      }
      failed.push(batch[index]);
      // The address itself is deliberately kept out of the log -- which
      // addresses bounced is the mail provider's delivery log to answer,
      // and repeating it here would put participant addresses in the
      // Worker's logs for every failed send.
      console.error('failed to send bulk mail to a recipient', {
        error: result.reason,
      });
    });
  }

  return {sent, failed};
}
