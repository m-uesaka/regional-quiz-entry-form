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

// The batching above only paces one call, while the provider's rate limit
// is shared by the whole team: another bulk send, or a verification or
// password-reset mail, can run at the same time and push the aggregate over
// the limit. A throttled send is therefore retried instead of being
// recorded as a permanently failed recipient, waiting as long as the
// provider asked (`Retry-After`) or, failing that, an exponential backoff.
//
// The retrying deliberately lives here and not in `ResendMailSender`: the
// single transactional sends (entry verification, password reset, waitlist
// promotion) are awaited inside a user-facing request, where stalling the
// response for seconds is worse than failing the send.
export const MAIL_MAX_RETRIES = 3;
export const MAIL_RETRY_BASE_DELAY_MS = 1000;
/**
 * Cap on a single retry wait.
 *
 * A queue consumer may run for minutes, so this is no longer the guard
 * against overrunning a budget that it was when the send hung off the
 * request's `waitUntil()`. What it still buys is that a provider answering
 * with an absurd `Retry-After` cannot hold the rest of the batch behind one
 * message: past this point the message is better off going back to the
 * queue, where it is redelivered on the queue's own schedule.
 */
export const MAIL_RETRY_MAX_DELAY_MS = 5_000;

export interface PacedMailOptions {
  /** Messages per batch; must be a positive integer. */
  batchSize?: number;
  intervalMs?: number;
  /** Extra attempts after a throttled send; must not be negative. */
  maxRetries?: number;
  /** First backoff wait when the provider names no `Retry-After`. */
  retryBaseDelayMs?: number;
}

/**
 * What became of one message.
 *
 * A failure carries the provider's own rejection rather than just a flag,
 * because the caller has to tell the two kinds apart: a throttle
 * (`MailSendError.isRateLimited()`) says nothing about the address and is
 * worth another delivery, while a rejection of the address itself would
 * only be rejected again.
 */
export type PacedMailOutcome = {ok: true} | {ok: false; error: unknown};

/** How a throttled send is retried. */
interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
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
  if (error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, MAIL_RETRY_MAX_DELAY_MS);
  }
  // Jittered, because a batch is throttled as a group: every message in it
  // hits the limit at the same instant, and an undithered backoff would
  // march them all back to the provider together and be throttled again.
  const backoffMs = Math.min(
    baseDelayMs * 2 ** attempt,
    MAIL_RETRY_MAX_DELAY_MS,
  );
  return backoffMs / 2 + Math.random() * (backoffMs / 2);
}

/**
 * Sends one message, retrying while the provider answers with a throttle.
 *
 * Rethrows the last rejection once the retries are exhausted, or straight
 * away for anything that isn't a throttle, so the caller can decide what
 * the recipient's fate is.
 */
async function sendWithRetry(
  mailer: MailSender,
  input: SendMailInput,
  policy: RetryPolicy,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await mailer.send(input);
      return;
    } catch (error) {
      const delayMs =
        attempt < policy.maxRetries
          ? retryDelayMs(error, attempt, policy.baseDelayMs)
          : null;
      if (delayMs === null) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

/**
 * Sends a list of messages in rate-controlled batches, reporting on each
 * one separately.
 *
 * Every recipient is mailed individually so no one sees anybody else's
 * address, and each message carries its own subject and body: one call may
 * be a queue batch holding messages from two different bulk sends.
 *
 * A message the provider rejects is reported in its own outcome rather
 * than aborting the run, so one bad address can't stop the rest of a
 * tournament from being notified. A send the provider merely throttled
 * (HTTP 429) is retried with backoff first, since that says nothing about
 * the address; only if the retries run out does it come back as a failed
 * outcome -- still carrying the throttle, for a caller that can have it
 * delivered again later.
 * @param mailer The mail sender to send through.
 * @param messages The messages to send, in order; duplicates are sent
 *     twice, so de-duplicate the recipients before calling.
 * @param options Overrides for the batch size, inter-batch wait, and retry
 *     behaviour.
 * @returns One outcome per message, positionally matching `messages`.
 * @throws RangeError If `options.batchSize` is not a positive integer or
 *     `options.maxRetries` is not a non-negative integer.
 */
export async function sendPacedMail(
  mailer: MailSender,
  messages: readonly SendMailInput[],
  options: PacedMailOptions = {},
): Promise<PacedMailOutcome[]> {
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
  // maxRetries` comparison above silently mean something other than "this
  // many extra tries", so reject it rather than guess.
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError(
      `maxRetries must be a non-negative integer, got ${maxRetries}`,
    );
  }

  const policy: RetryPolicy = {maxRetries, baseDelayMs: retryBaseDelayMs};
  const outcomes: PacedMailOutcome[] = [];

  for (let start = 0; start < messages.length; start += batchSize) {
    if (start > 0) {
      await sleep(intervalMs);
    }

    const batch = messages.slice(start, start + batchSize);
    const results = await Promise.allSettled(
      batch.map(message => sendWithRetry(mailer, message, policy)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        outcomes.push({ok: true});
        continue;
      }
      outcomes.push({ok: false, error: result.reason});
      // The address itself is deliberately kept out of the log -- which
      // addresses bounced is the mail provider's delivery log to answer,
      // and repeating it here would put participant addresses in the
      // Worker's logs for every failed send.
      console.error('failed to send bulk mail to a recipient', {
        error: result.reason,
      });
    }
  }

  return outcomes;
}
