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
 * Kept well under `BACKGROUND_SEND_BUDGET_MS`: the wait happens inside the
 * background run, so one message honouring an absurd `Retry-After` would
 * otherwise burn the whole budget and cost every recipient still queued
 * behind it their send.
 */
export const MAIL_RETRY_MAX_DELAY_MS = 5_000;

// Cloudflare keeps a Worker alive for `waitUntil()` work only for about 30
// seconds after the response has been sent, then cancels whatever is still
// pending. A send paced by the batching above therefore has a hard ceiling
// on how many recipients it can reach from a background task, and handing
// it more would drop the tail silently.
export const BACKGROUND_SEND_BUDGET_MS = 30_000;

// Only part of that budget may go on the deliberate waits between batches:
// the sends themselves need network time, and a throttled one waits out a
// `Retry-After` on top of it. Half the budget is left for those, so the
// ceiling below stays reachable rather than being the theoretical best case.
const PACING_BUDGET_RATIO = 0.5;

/**
 * How many recipients a background `sendBulkMail()` run with the default
 * pacing can be expected to finish before the platform cancels it.
 *
 * This is the figure for a run the provider does not throttle. Sustained
 * throttling can still exhaust the budget below the ceiling, which is why
 * the run tracks its own deadline rather than trusting this number alone.
 *
 * Sending to more than this many addresses needs the send to outlive the
 * request that started it -- see the TODO on the staff bulk-mail route
 * about moving the paced send onto a durable Cloudflare Queue consumer.
 */
export const MAX_BACKGROUND_RECIPIENTS =
  (Math.floor(
    (BACKGROUND_SEND_BUDGET_MS * PACING_BUDGET_RATIO) / MAIL_BATCH_INTERVAL_MS,
  ) +
    1) *
  MAIL_BATCH_SIZE;

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
  /**
   * Wall-clock the whole run may take, in milliseconds; must be positive.
   * Defaults to the platform's post-response budget.
   */
  budgetMs?: number;
}

export interface BulkMailResult {
  sent: number;
  /**
   * The recipients this run did not deliver to, in the given order --
   * whether the provider rejected the address or the run ran out of its
   * budget before reaching it.
   */
  failed: string[];
}

/** How a throttled send is retried, and by when the run must be over. */
interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  /** Epoch milliseconds the run must have finished by. */
  deadline: number;
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
 * away for anything that isn't a throttle, so the caller can record the
 * recipient as failed.
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
      // A retry that would end after the run's deadline is worse than no
      // retry at all: the platform cancels the run while this message
      // waits, so every recipient still queued behind it loses their
      // attempt too. Give this one up and let the rest proceed.
      if (delayMs === null || Date.now() + delayMs > policy.deadline) {
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
 *
 * The run keeps to `options.budgetMs`. Being throttled can make even a
 * list within `MAX_BACKGROUND_RECIPIENTS` overrun it, and a background run
 * that overruns is cancelled by the platform mid-flight with nothing
 * reported; stopping at the deadline instead leaves the untried recipients
 * in `failed`, where the caller can log them.
 * @param mailer The mail sender to send through.
 * @param recipients The addresses to mail; duplicates are mailed twice, so
 *     de-duplicate before calling.
 * @param content The subject and HTML body every recipient receives.
 * @param options Overrides for the batch size, inter-batch wait, retry
 *     behaviour, and the run's own budget.
 * @throws RangeError If `options.batchSize` is not a positive integer,
 *     `options.maxRetries` is not a non-negative integer, or
 *     `options.budgetMs` is not a positive number.
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
  const budgetMs = options.budgetMs ?? BACKGROUND_SEND_BUDGET_MS;

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
  // Written as a positive test so `NaN` is rejected along with 0 and the
  // negatives, none of which leave the run any time to send in.
  if (!(budgetMs > 0)) {
    throw new RangeError(`budgetMs must be a positive number, got ${budgetMs}`);
  }

  const deadline = Date.now() + budgetMs;
  const policy: RetryPolicy = {
    maxRetries,
    baseDelayMs: retryBaseDelayMs,
    deadline,
  };

  let sent = 0;
  const failed: string[] = [];

  for (let start = 0; start < recipients.length; start += batchSize) {
    if (start > 0) {
      // Stop rather than start a wait that runs past the deadline: the
      // platform would cancel the run in the middle of it, and the
      // recipients left over would go unmailed with nobody the wiser.
      if (Date.now() + intervalMs > deadline) {
        const remaining = recipients.slice(start);
        failed.push(...remaining);
        console.error('bulk mail ran out of its background budget', {
          budgetMs,
          sent,
          unreachedCount: remaining.length,
        });
        break;
      }
      await sleep(intervalMs);
    }

    const batch = recipients.slice(start, start + batchSize);
    const results = await Promise.allSettled(
      batch.map(to => sendWithRetry(mailer, {to, ...content}, policy)),
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
